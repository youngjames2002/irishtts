(function () {
  var saved = localStorage.getItem('tts-theme') || 'sega';
  document.documentElement.className = 'theme-' + saved;
}());
