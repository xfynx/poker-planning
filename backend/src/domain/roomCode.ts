import { randomInt } from "node:crypto";

const adjectives = "calm bright quiet happy cozy gentle lucky sunny tiny bold clever swift brave merry kind cool warm soft wild wise fresh lively silent sleepy fuzzy little nimble playful proud keen crisp dreamy".split(" ");
const colors = "amber azure blue coral gold green indigo ivory jade lilac lime mint olive peach pearl pink plum purple red rose ruby silver teal violet white yellow bronze copper honey maple moss sandy".split(" ");
const animals = "otter fox panda owl lynx bear koala whale robin deer hare seal swan dove finch crane raven lark heron eagle falcon kiwi penguin puffin parrot toucan sparrow badger beaver bison camel cat cheetah dog dolphin duck elk ferret gecko goose horse ibex jaguar kitten llama lion meerkat moose mouse newt ocelot orca osprey pony rabbit raccoon sloth squirrel tiger turtle walrus wolf wombat zebra".split(" ");

// Keep old six-character links and Redis keys working; word codes use lowercase.
export function normalizeRoomCode(code: string): string {
  const trimmed = code.trim();
  return trimmed.includes("-") ? trimmed.toLowerCase() : trimmed.toUpperCase();
}

export function generateRoomCode(): string {
  return [adjectives, colors, animals].map((words) => words[randomInt(words.length)]).join("-");
}
