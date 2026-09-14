(function () {
  var SITE_NAME = "Clovis Star Gnostic Library";
  var SITE_URL = "https://clovisstar.com";

  function buildAttribution() {
    var title = document.querySelector("h1") && document.querySelector("h1").textContent.trim();
    var pageTitle = title || document.title || SITE_NAME;
    return "Source: " + pageTitle + " — " + SITE_NAME + " (" + SITE_URL + ")";
  }

  function htmlEscape(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  document.addEventListener("copy", function (event) {
    var selection = window.getSelection();
    var selectedText = selection ? selection.toString().trim() : "";
    if (!selectedText) return;

    var attribution = buildAttribution();
    var plainText = selectedText + "\n\n" + attribution;
    var htmlText = "<blockquote>" + htmlEscape(selectedText).replace(/\n/g, "<br>") + "</blockquote><p>" + htmlEscape(attribution) + "</p>";

    event.clipboardData.setData("text/plain", plainText);
    event.clipboardData.setData("text/html", htmlText);
    event.preventDefault();
  });
}());

