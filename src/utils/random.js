const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const rand = (min, max) => Math.random() * (max - min) + min;
const randInt = (min, max) => Math.floor(rand(min, max + 1));

// Distribution skewed towards low values with an occasional long pause,
// like real human reaction times.
const skewed = (min, max) => min + (max - min) * Math.pow(Math.random(), 1.7);
const delay = (min, max) => sleep(Math.round(skewed(min, max)));

function shuffle(array) {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

module.exports = { sleep, rand, randInt, skewed, delay, shuffle };
