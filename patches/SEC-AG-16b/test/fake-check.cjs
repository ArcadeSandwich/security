"use strict";
// A stand-in for the Playbook's check.js in tests: ONE made-up "live" secret, never a real one.
const FAKE = "FakeLiveValue7Q2mZ9xK4pW8rT3vB6nY1c";
module.exports = {
  FAKE,
  loadLiveSecrets: () => ({ secrets: [{ name: "FAKE_TEST_KEY", value: FAKE, wholeWord: false }] }),
};
