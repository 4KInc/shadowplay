import { randomInt } from 'node:crypto';

/**
 * Family codes: three friendly words and a number (e.g. "lantern-otter-moss-417"),
 * easy to read aloud on a call or type on a tablet. 256^3 x 1000 combinations,
 * with lookups rate-limited, so codes cannot practically be guessed.
 */
const WORDS = (
  'acorn amber apple arrow aspen autumn badger bamboo banjo barley basket beacon beaver berry birch biscuit ' +
  'blossom bluebell bramble breeze brook bubble bumble button cabin camel candle canyon caramel cedar cello cherry ' +
  'chestnut cinnamon clover cloud cobble comet compass coral cosmos cottage cricket crocus crystal cuckoo daisy dandelion ' +
  'dawn delta dewdrop dolphin dove dragonfly drum dune eagle ember fable falcon feather fern fiddle firefly flute ' +
  'forest fossil fox garden gecko ginger glacier glow gnome goose grove gull harbor harvest hazel heather hedgehog ' +
  'heron hickory hill honey hummingbird iris island ivy jade jasmine jelly juniper kayak kettle kite koala lagoon ' +
  'lantern lark lavender leaf lemon lilac lily linen lotus lullaby lynx maple marble marigold meadow melody mint ' +
  'mirror mist mitten moon moss mountain mouse muffin nectar nest nightjar nutmeg oak oasis ocean olive orbit orchid ' +
  'otter owl paddle panda pebble pecan pepper petal pigeon pine planet plum pond poppy puffin pumpkin quail quill ' +
  'rabbit raindrop raven reed ribbon river robin rocket rose ruby saffron sage sail sandpiper sapphire satchel sequoia ' +
  'shell shore sierra silver skylark sleigh snowdrop sparrow spice spruce squirrel star stone storm sugar summit sunbeam ' +
  'swallow swan teacup thistle thunder tide tiger timber toffee topaz tortoise trail tulip tundra turtle twig valley ' +
  'velvet violet walnut wander wave whale whisker willow window winter wren yarrow zephyr acorncap bellflower bluejay ' +
  'bonfire bookworm brightstar campfire cloudberry cornflower dreamboat everglade fairyring glowworm goldfinch hayloft ' +
  'hilltop honeybee kingfisher lamplight moonbeam nightlight pinecone puddle rainbow riverbank seashell shadow snowflake ' +
  'starling stardust sunflower teapot tumbleweed waterfall wildflower windmill woodland'
).split(' ');

export function newCode(): string {
  const w = () => WORDS[randomInt(WORDS.length)];
  return `${w()}-${w()}-${w()}-${randomInt(100, 1000)}`;
}

/** Codes are lowercase words and digits joined by dashes; reject anything else before touching storage. */
export function isCode(code: string): boolean {
  return /^[a-z]{2,16}-[a-z]{2,16}-[a-z]{2,16}-\d{3}$/.test(code);
}

export function normaliseCode(input: string): string {
  return input.trim().toLowerCase().replace(/\s+/g, '-');
}
