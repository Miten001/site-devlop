/* Match actual hostnames, never substrings in paths, queries or userinfo. */
(function () {
  "use strict";
  const hosts = {
    telegram: ["t.me", "telegram.me", "telegram.dog"],
    youtube: ["youtube.com", "youtu.be", "youtube-nocookie.com"],
    instagram: ["instagram.com", "instagr.am"],
    x: ["x.com", "twitter.com"],
    tiktok: ["tiktok.com"],
    facebook: ["facebook.com", "fb.com", "fb.me"],
    twitch: ["twitch.tv"],
    pinterest: ["pinterest.com", "pin.it", "pinterest.co.uk", "pinterest.ca", "pinterest.de", "pinterest.fr", "pinterest.es", "pinterest.it", "pinterest.jp", "pinterest.com.au", "pinterest.co.in"]
  };
  window.FFCampaignURL = {
    hosts,
    matches(platform, value) {
      let url;
      try { url = new URL(value); } catch (_) { return false; }
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || !url.hostname.includes(".")) return false;
      if (platform === "website") return true;
      return (hosts[platform] || []).some(host => url.hostname === host || url.hostname.endsWith("." + host));
    },
    warning(platform, name) {
      return "Warning: this link does not match the selected " + (name || platform) + " platform. You may continue, but an administrator can review the mismatch. Choose Website Visits for a general website link.";
    }
  };
})();
