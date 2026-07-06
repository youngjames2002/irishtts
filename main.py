from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import psycopg2
import psycopg2.extras
import secrets
import httpx
import datetime
import json

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

ADMIN_PASSWORD = "REDACTED_SEE_ENV_ADMIN_PASSWORD"
ADMIN_TOKEN = secrets.token_hex(32)
STARTGG_TOKEN = "REDACTED_SEE_ENV_STARTGG_TOKEN"

def get_db():
    return psycopg2.connect(
        dbname="irishtts",
        user="postgres",
        password="REDACTED_SEE_ENV_DB_PASSWORD",
        host="localhost"
    )

def calculate_points(region_count: int, entrants: int, five_pt: int, three_pt: int) -> tuple:
    bonus = round(min(100 / region_count, 30))
    total = entrants + (five_pt * 5) + (three_pt * 3) + bonus
    return bonus, total

def get_region_counts(conn) -> dict:
    cur = conn.cursor()
    cur.execute("SELECT region, COUNT(*) FROM events GROUP BY region")
    return {row[0]: row[1] for row in cur.fetchall()}

def check_auth(authorization: Optional[str] = None):
    if authorization != f"Bearer {ADMIN_TOKEN}":
        raise HTTPException(status_code=401, detail="Unauthorized")

# --- AUTH ---

class AuthRequest(BaseModel):
    password: str

@app.post("/auth")
def auth(req: AuthRequest):
    if req.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    return {"token": ADMIN_TOKEN}

# --- TIERS ---

@app.get("/tiers")
def get_tiers():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM tiers ORDER BY min_points DESC")
    return cur.fetchall()

class TierUpdate(BaseModel):
    name: Optional[str] = None
    min_points: Optional[int] = None

@app.put("/tiers/{id}")
def update_tier(id: int, tier: TierUpdate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE tiers SET name = COALESCE(%s, name), min_points = COALESCE(%s, min_points) WHERE id = %s",
        (tier.name, tier.min_points, id)
    )
    conn.commit()
    return {"message": "Tier updated"}

@app.post("/tiers")
def create_tier(tier: TierUpdate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "INSERT INTO tiers (name, min_points) VALUES (%s, %s) RETURNING id",
        (tier.name, tier.min_points)
    )
    conn.commit()
    return {"message": "Tier created", "id": cur.fetchone()["id"]}

@app.delete("/tiers/{id}")
def delete_tier(id: int, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM tiers WHERE id = %s", (id,))
    conn.commit()
    return {"message": "Tier deleted"}

# --- EVENTS ---

@app.get("/events")
def get_events():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM events ORDER BY date DESC")
    events = cur.fetchall()
    region_counts = get_region_counts(conn)
    result = []
    for event in events:
        row = dict(event)
        if row.get("region") and row.get("entrants") is not None and row.get("five_point_players") is not None and row.get("three_point_players") is not None:
            count = region_counts.get(row["region"], 1)
            row["regional_bonus_points"], row["points_value"] = calculate_points(
                count, row["entrants"], row["five_point_players"], row["three_point_players"]
            )
        result.append(row)
    return result

@app.get("/events/{id}")
def get_event(id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM events WHERE id = %s", (id,))
    event = cur.fetchone()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    row = dict(event)
    if row.get("region") and row.get("entrants") is not None and row.get("five_point_players") is not None and row.get("three_point_players") is not None:
        region_counts = get_region_counts(conn)
        count = region_counts.get(row["region"], 1)
        row["regional_bonus_points"], row["points_value"] = calculate_points(
            count, row["entrants"], row["five_point_players"], row["three_point_players"]
        )
    return row

class EventCreate(BaseModel):
    name: str
    startgg_link: Optional[str] = None
    date: Optional[str] = None
    region: Optional[str] = None
    entrants: Optional[int] = None
    five_point_players: Optional[int] = None
    three_point_players: Optional[int] = None

@app.post("/events")
def create_event(event: EventCreate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        INSERT INTO events (name, startgg_link, date, region, entrants, five_point_players, three_point_players)
        VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id
    """, (event.name, event.startgg_link, event.date, event.region, event.entrants,
          event.five_point_players, event.three_point_players))
    conn.commit()
    return {"message": "Event created", "id": cur.fetchone()["id"]}

@app.put("/events/{id}")
def update_event(id: int, event: EventCreate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("""
        UPDATE events SET name=%s, startgg_link=%s, date=%s, region=%s, entrants=%s,
        five_point_players=%s, three_point_players=%s WHERE id=%s
    """, (event.name, event.startgg_link, event.date, event.region, event.entrants,
          event.five_point_players, event.three_point_players, id))
    conn.commit()
    return {"message": "Event updated"}

@app.delete("/events/{id}")
def delete_event(id: int, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM event_players WHERE event_id = %s", (id,))
    cur.execute("DELETE FROM events WHERE id = %s", (id,))
    conn.commit()
    return {"message": "Event deleted"}

# --- PLAYERS ---

@app.get("/players")
def get_players():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM players ORDER BY points_value DESC, tag")
    return cur.fetchall()

class PlayerCreate(BaseModel):
    tag: str
    points_value: int
    points_source: Optional[str] = None

@app.post("/players")
def create_player(player: PlayerCreate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute(
        "INSERT INTO players (tag, points_value, points_source) VALUES (%s, %s, %s) RETURNING id",
        (player.tag, player.points_value, player.points_source)
    )
    conn.commit()
    return {"message": "Player created", "id": cur.fetchone()["id"]}

@app.put("/players/{id}")
def update_player(id: int, player: PlayerCreate, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute(
        "UPDATE players SET tag=%s, points_value=%s, points_source=%s WHERE id=%s",
        (player.tag, player.points_value, player.points_source, id)
    )
    conn.commit()
    return {"message": "Player updated"}

@app.delete("/players/{id}")
def delete_player(id: int, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM event_players WHERE player_id = %s", (id,))
    cur.execute("DELETE FROM players WHERE id = %s", (id,))
    conn.commit()
    return {"message": "Player deleted"}

# --- STARTGG ---

class StartggRequest(BaseModel):
    slug: str

@app.post("/startgg/event")
async def get_startgg_event(req: StartggRequest, authorization: Optional[str] = Header(None)):
    check_auth(authorization)

    query = """
    query EventData($slug: String!) {
      event(slug: $slug) {
        name
        startAt
        tournament {
          name
          venueAddress
          city
          addrState
          countryCode
        }
        entrants(query: { perPage: 500 }) {
          nodes {
            participants {
              player {
                gamerTag
              }
            }
          }
        }
      }
    }
    """

    async with httpx.AsyncClient() as client:
        res = await client.post(
            "https://api.start.gg/gql/alpha",
            json={"query": query, "variables": {"slug": req.slug}},
            headers={
                "Authorization": f"Bearer {STARTGG_TOKEN}",
                "Content-Type": "application/json"
            },
            timeout=60
        )

    data = res.json()

    if "errors" in data or not data.get("data", {}).get("event"):
        raise HTTPException(status_code=400, detail="Event not found on start.gg")

    event = data["data"]["event"]
    tournament = event["tournament"]
    entrants = event["entrants"]["nodes"]
    entrant_count = len(entrants)

    # Get all entrant tags
    entrant_tags = []
    for e in entrants:
        for p in e.get("participants", []):
            tag = p.get("player", {}).get("gamerTag", "")
            if tag:
                entrant_tags.append(tag.lower())

    # Cross reference with players DB
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM players")
    db_players = cur.fetchall()

    matched_players = []
    for p in db_players:
        if p["tag"].lower() in entrant_tags:
            matched_players.append({
                "id": p["id"],
                "tag": p["tag"],
                "points_value": p["points_value"],
                "points_source": p["points_source"]
            })

    five_pt = [p for p in matched_players if p["points_value"] == 5]
    three_pt = [p for p in matched_players if p["points_value"] == 3]

    # Guess region from location
    location = f"{tournament.get('city','')} {tournament.get('addrState','')} {tournament.get('venueAddress','')}".lower()
    region_map = {
        'Leinster': ['dublin','kildare','wicklow','wexford','carlow','kilkenny','laois','offaly','longford','westmeath','meath','louth'],
        'Ulster':   ['belfast','antrim','armagh','derry','londonderry','down','fermanagh','tyrone','cavan','monaghan','donegal'],
        'Munster':  ['cork','kerry','limerick','tipperary','waterford','clare'],
        'Connacht': ['galway','mayo','sligo','leitrim','roscommon']
    }
    guessed_region = 'Leinster'
    for region, keywords in region_map.items():
        if any(k in location for k in keywords):
            guessed_region = region
            break

    date_str = None
    if event.get("startAt"):
        date_str = datetime.datetime.utcfromtimestamp(event["startAt"]).strftime("%Y-%m-%d")

    region_counts = get_region_counts(conn)
    region_count = region_counts.get(guessed_region, 0) + 1
    bonus, total = calculate_points(region_count, entrant_count, len(five_pt), len(three_pt))

    return {
        "name": f"{tournament['name']} - {event['name']}",
        "date": date_str,
        "region": guessed_region,
        "entrants": entrant_count,
        "five_point_players": len(five_pt),
        "three_point_players": len(three_pt),
        "regional_bonus_points": bonus,
        "points_value": total,
        "matched_five": five_pt,
        "matched_three": three_pt,
    }

# --- EVENT PLAYERS ---

@app.post("/events/{event_id}/players/{player_id}")
def add_player_to_event(event_id: int, player_id: int, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("INSERT INTO event_players (event_id, player_id) VALUES (%s, %s)", (event_id, player_id))
    conn.commit()
    return {"message": "Player added to event"}

@app.get("/events/{event_id}/players")
def get_event_players(event_id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("""
        SELECT p.* FROM players p
        JOIN event_players ep ON p.id = ep.player_id
        WHERE ep.event_id = %s
    """, (event_id,))
    return cur.fetchall()

# --- SEASONS ---

class Season(BaseModel):
    name: str

class NewSeasonRequest(BaseModel):
    password: str

@app.get("/seasons")
def get_seasons():
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT id, name, archived_at FROM seasons ORDER BY archived_at DESC")
    return cur.fetchall()

@app.get("/seasons/{id}")
def get_season(id: int):
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM seasons WHERE id = %s", (id,))
    season = cur.fetchone()
    if not season:
        raise HTTPException(status_code=404, detail="Season not found")
    return season

@app.post("/seasons")
def create_season(season: Season, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
    cur.execute("SELECT * FROM events")
    raw_events = cur.fetchall()
    region_counts = get_region_counts(conn)
    events = []
    for event in raw_events:
        row = dict(event)
        if row.get("region") and row.get("entrants") is not None and row.get("five_point_players") is not None and row.get("three_point_players") is not None:
            count = region_counts.get(row["region"], 1)
            row["regional_bonus_points"], row["points_value"] = calculate_points(
                count, row["entrants"], row["five_point_players"], row["three_point_players"]
            )
        events.append(row)
    cur.execute("SELECT * FROM players")
    players = [dict(r) for r in cur.fetchall()]
    cur.execute("SELECT * FROM tiers")
    tiers = [dict(r) for r in cur.fetchall()]
    snapshot = json.dumps({"events": events, "players": players, "tiers": tiers}, default=str)
    cur.execute(
        "INSERT INTO seasons (name, data) VALUES (%s, %s) RETURNING id",
        (season.name, snapshot)
    )
    conn.commit()
    return {"message": "Season created", "id": cur.fetchone()["id"]}

@app.put("/seasons/{id}")
def update_season(id: int, season: Season, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("UPDATE seasons SET name = %s WHERE id = %s", (season.name, id))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Season not found")
    return {"message": "Season updated"}

@app.delete("/seasons/{id}")
def delete_season(id: int, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM seasons WHERE id = %s", (id,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Season not found")
    return {"message": "Season deleted"}

@app.post("/seasons/new")
def new_season(req: NewSeasonRequest, authorization: Optional[str] = Header(None)):
    check_auth(authorization)
    if req.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Wrong password")
    conn = get_db()
    cur = conn.cursor()
    cur.execute("DELETE FROM event_players")
    cur.execute("DELETE FROM events")
    cur.execute("DELETE FROM players")
    cur.execute("DELETE FROM tiers")
    conn.commit()
    return {"message": "Season reset complete"}