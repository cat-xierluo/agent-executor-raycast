const raycastConfig = require("@raycast/eslint-config");

module.exports = raycastConfig.flatMap((entry) =>
  Array.isArray(entry) ? entry : [entry],
);
