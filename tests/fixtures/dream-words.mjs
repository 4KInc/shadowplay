// A reply as Claude might write it for "Dream up a new story" (server tests and
// the sim build stories from it with server/dream.ts assembleStory).
const ASK = {
  rabbit: 'Make a rabbit with your hand: two tall ears up, and hold it still.',
  fish: 'Make a fish: a flat hand, fingers together, and let it swim.',
  dog: 'Make a dog with your hand, its ear up, and say a soft woof.',
  bird: 'Make a bird with two hands side by side, and spread your wings.',
  cup: 'Cup your hands together softly, to hold the little light.',
};

/** The words for these shapes; `broken` leaves the shape's name out of every request (which must be refused). */
export function cannedWords(shapes, { broken = false } = {}) {
  return JSON.stringify({
    title: 'The Lantern Tide',
    opening: ['The sea is hushed tonight, and the waves are whispering.', 'Mo flutters down to see who is still awake.'],
    scenes: shapes.map((shape) => ({
      shape,
      setup: `A small light is drifting far away, and Mo needs a friend to reach it.`,
      ask: broken ? 'Make a shape with your hand and hold it still.' : ASK[shape],
      ride: 'Off we go, softly.',
      after: 'There it is, glowing like a sleepy star.',
      bow: 'The creature curls up and closes its eyes.',
    })),
    ending: ['The little lights are home, and the sea is calm.', 'Goodnight, little one. Mo is sleepy too.'],
  });
}
