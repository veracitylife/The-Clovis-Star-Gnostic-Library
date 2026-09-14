(function () {
  async function jsonFetch(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      var error = new Error(data.error || "Voice reading request failed.");
      error.status = response.status;
      error.details = data;
      throw error;
    }
    return data;
  }

  async function getSettings() {
    if (window.__clovisVoiceSettings) return window.__clovisVoiceSettings;
    window.__clovisVoiceSettings = jsonFetch("/api/voice/settings");
    return window.__clovisVoiceSettings;
  }

  async function requestReading(input) {
    return jsonFetch("/api/voice/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input || {})
    });
  }

  window.ClovisStarVoiceReading = {
    getSettings: getSettings,
    requestReading: requestReading,
    frontendVisible: false
  };
}());

