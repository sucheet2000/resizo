// This file forces Next.js to use Babel instead of SWC.
// Required in environments where the SWC binary cannot be downloaded.
module.exports = {
  presets: ['next/babel'],
};
