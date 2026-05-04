const fs = require('fs');
const path = require('path');

const serverSource = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

function assertContains(value, label) {
  if (!serverSource.includes(value)) {
    throw new Error(`Missing audio quality setting: ${label}`);
  }
}

function assertNotContains(value, label) {
  if (serverSource.includes(value)) {
    throw new Error(`Low quality audio setting is still present: ${label}`);
  }
}

assertContains("'48000'", 'OPUS 48kHz sample rate');
assertContains("'320k'", '320k audio bitrate');
assertContains("'libopus'", 'OPUS encoder');
assertContains("'libmp3lame'", 'MP3 encoder');
assertContains("'aac'", 'AAC encoder');
assertContains("'slow'", 'higher quality video backup preset');
assertContains("'0'", 'highest LAME quality flag');
assertContains(
  "path.join(__dirname, 'dependencies', 'yt-dlp-exec', 'bin', 'yt-dlp')",
  'Linux yt-dlp dependency fallback'
);

assertNotContains("'16000'", '16kHz OPUS sample rate');
assertNotContains("'16k'", '16k OPUS bitrate');
assertNotContains("'1',\n      '-ar'", 'mono downmix before sample rate');
assertNotContains("'160k'", '160k backup audio bitrate');
assertNotContains("'192k'", '192k backup audio bitrate');

console.log('audio quality settings passed');
