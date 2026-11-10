"""
Writes the newer library stories as story JSON (public/story/*.story.json) and the
library index (public/story/library.json). Each story uses only existing creatures,
scenery and beat types. Beat ids are unique across the whole library.
  python3 scripts/stories/library.py
"""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'public/story'


class Story:
    def __init__(self, prefix, title):
        self.prefix, self.title, self.beats = prefix, title, []

    def b(self, id, type, **k):
        self.beats.append({'id': f'{self.prefix}-{id}', 'type': type, **k})
        return self

    def write(self, name):
        ids = [x['id'] for x in self.beats]
        assert len(ids) == len(set(ids)), 'duplicate beat id'
        (ROOT / f'{name}.story.json').write_text(json.dumps({'version': 'shadowplay.story.v1', 'title': self.title, 'beats': self.beats}, indent=2) + '\n')


# ---------------------------------------------------------------- The Letter That Took the Slow Way
s = Story('letter', 'The Letter That Took the Slow Way')
s.b('title', 'chapter', chapter='The Letter That Took the Slow Way', text='The Letter That Took the Slow Way')
s.b('lamp', 'lamp', level=1)
s.b('far', 'narrate', text='Far away, someone who loves {child|you} wrote a letter, and folded it very small.')
s.b('mo', 'moth', mode='arriving')
s.b('mo-finds', 'narrate', text='Mo found it on the doorstep. But a letter is heavy for a moth. She needs a friend who is never in a hurry.')
s.b('forest', 'scenery', set='forest')
s.b('mo-rests', 'moth', mode='resting', restU=-0.4, restV=0.02)
s.b('want-snail', 'request', shape='snail', text='Make a snail: a fist for the shell, and two fingers poking forward for its eyes.')
s.b('snail-yes', 'narrate', text='A snail! Slow and steady. That is all right. Letters can wait.')
s.b('snail-ride', 'moth', mode='riding')
s.b('snail-carry', 'carry', toU=0.3, text='Carry the letter along the forest path. Slowly now.')
s.b('snail-land', 'moth', mode='resting', restU=0.42, restV=0.03)
s.b('snail-bows', 'release', text='The snail tucks itself into its shell, for a little sleep.')
s.b('river', 'scenery', set='river')
s.b('river-rest', 'moth', mode='resting', restU=-0.42, restV=0.05)
s.b('river-text', 'narrate', text='Then the river, still and dark. Too wide for a snail, and too wet for a letter.')
s.b('want-swan', 'request', shape='swan', text='Make a swan: a flat hand, bent down at the wrist, like a long neck and a beak.')
s.b('swan-yes', 'narrate', text='A swan, smooth and white. Hold the letter high, Mo.')
s.b('swan-ride', 'moth', mode='riding')
s.b('swan-carry', 'carry', toU=0.3, text='Glide across the river.')
s.b('swan-land', 'moth', mode='resting', restU=0.42, restV=0.04)
s.b('swan-bows', 'release', text='The swan folds its neck and floats away.')
s.b('field', 'scenery', set='field')
s.b('field-rest', 'moth', mode='resting', restU=-0.42, restV=0.04)
s.b('field-text', 'narrate', text='The last part is a big meadow, and night is coming fast.')
s.b('want-deer', 'request', shape='deer', text='Make a deer with two hands: wrists together, fingers up and spread, like antlers.')
s.b('deer-yes', 'narrate', text='A deer! Quick and gentle. Off you go.')
s.b('deer-ride', 'moth', mode='riding')
s.b('deer-carry', 'carry', toU=0.32, text='Leap across the meadow.')
s.b('deer-land', 'moth', mode='resting', restU=0.4, restV=0.1)
s.b('deer-bows', 'release', text='The deer bows its antlers, and is gone.')
s.b('home', 'scenery', set='none')
s.b('dim', 'lamp', level=0.6)
s.b('window', 'moth', mode='resting', restU=0, restV=0.12)
s.b('arrives', 'narrate', text='And at last, the letter arrives, at your window, {child|little one}.')
s.b('want-cup', 'request', shape='cup', text='Cup your hands together, to hold the letter.')
s.b('reads', 'narrate', text='Inside it says: I am thinking of you. I took the slow way, but I always come.')
s.b('letgo', 'letgo', text='Now open your hands, and let the words float up.')
s.b('free', 'release', text='The words drift up, like little stars...')
s.b('finale', 'finale', seconds=4)
s.b('goodnight', 'narrate', text='Goodnight, {child|little one}. The slow way is still the way home.')
s.b('mo-glow', 'moth', mode='hovering', restU=0.12, restV=0.18)
s.b('the-end', 'chapter', chapter='The End', text='The End')
s.b('end', 'end', text='The End')
s.write('the-slow-letter')

# ---------------------------------------------------------------- The Brave Little Dog
s = Story('brave', 'The Brave Little Dog')
s.b('title', 'chapter', chapter='The Brave Little Dog', text='The Brave Little Dog')
s.b('lamp', 'lamp', level=1)
s.b('tonight', 'narrate', text='Tonight, {child|little one}, someone you love is far away. So tonight, you get to be brave for both of you.')
s.b('mo', 'moth', mode='arriving')
s.b('mo-scared', 'narrate', text="Mo needs to get home through the dark woods. But she's scared. She needs a brave friend.")
s.b('want-dog', 'request', shape='dog', alt='rabbit', text='Make a dog: a flat hand, thumb up for an ear, and your little finger down for its mouth.')
s.b('dog-yes', 'narrate', text='A little dog! Small, but very brave.')
s.b('forest', 'scenery', set='forest')
s.b('mo-path', 'moth', mode='resting', restU=-0.42, restV=0.0)
s.b('wolf-in', 'actor', state='blocking', u=0.26, v=-0.26)
s.b('wolf', 'narrate', text='Oh! On the path, a big grey wolf. The little dog feels its heart go thump.')
s.b('be-big', 'narrate', text="But being brave doesn't mean not being scared. It means growing bigger than your scare.")
s.b('grow', 'grow', factor=1.7, minSize=0.38, text='Bring your hand close to the lamp. Grow, and grow, until you are huge!')
s.b('wolf-flees', 'actor', state='fleeing')
s.b('wolf-gone', 'narrate', text='The wolf takes one look at your great big shadow, and runs away.')
s.b('dog-bows', 'release', text='The little dog wags its tail. Brave dog.')
s.b('river', 'scenery', set='river')
s.b('river-rest', 'moth', mode='resting', restU=-0.42, restV=0.05)
s.b('river-text', 'narrate', text='Next, a river. And in the river, a crocodile, with a very big grin.')
s.b('croc-kind', 'narrate', text="Some things look scary, but they're kind inside. Shall we ask it for help?")
s.b('want-croc', 'request', shape='crocodile', text='Make a crocodile: two flat hands, one on top of the other, like a long snappy mouth.')
s.b('croc-yes', 'narrate', text='A friendly crocodile! Climb on its back, Mo.')
s.b('croc-ride', 'moth', mode='riding')
s.b('croc-carry', 'carry', toU=0.3, text='Swim across the river.')
s.b('croc-land', 'moth', mode='resting', restU=0.42, restV=0.03)
s.b('croc-bows', 'release', text='The crocodile smiles its biggest smile, and sinks out of sight.')
s.b('storm', 'scenery', set='storm')
s.b('storm-rest', 'moth', mode='buffeted', restU=-0.36, restV=0.0)
s.b('storm-text', 'narrate', text='Last of all, the wind. It huffs and puffs. But you have been brave all night.')
s.b('want-bird', 'request', shape='bird', text='Make a bird with two hands, side by side, thumbs together. Carry Mo home over the wind.')
s.b('bird-yes', 'narrate', text='A bird! Up and over.')
s.b('bird-ride', 'moth', mode='riding')
s.b('bird-carry', 'carry', toU=0.34, minV=0.12, text='Fly high, all the way home.')
s.b('bird-land', 'moth', mode='resting', restU=0.4, restV=0.2)
s.b('bird-bows', 'release', text='Home at last.')
s.b('calm', 'scenery', set='none')
s.b('dim', 'lamp', level=0.6)
s.b('proud', 'narrate', text='Someone far away would be so proud of you tonight, {child|little one}. You were brave, even when it was dark.')
s.b('finale', 'finale', seconds=4)
s.b('goodnight', 'narrate', text='Goodnight, brave one. Sleep tight.')
s.b('mo-glow', 'moth', mode='hovering', restU=0.12, restV=0.18)
s.b('the-end', 'chapter', chapter='The End', text='The End')
s.b('end', 'end', text='The End')
s.write('the-brave-little-dog')

# ---------------------------------------------------------------- Counting Stars
s = Story('stars', 'Counting Stars')
s.b('title', 'chapter', chapter='Counting Stars', text='Counting Stars')
s.b('lamp', 'lamp', level=1)
s.b('shh', 'narrate', text="Shh. It's nearly sleepy time, {child|little one}. Let's count the stars together.")
s.b('mo', 'moth', mode='arriving')
s.b('follow', 'follow', seconds=3, text='Hold up your hand. Mo will follow your finger, slowly, slowly.')
s.b('one', 'narrate', text='Here is star number one. Mo saw it first.')
s.b('want-bird', 'request', shape='bird', text='Make a bird with two hands, side by side. Fly up to find star number two.')
s.b('bird-ride', 'moth', mode='riding')
s.b('bird-carry', 'carry', toU=0.3, minV=0.12, text='Fly up, up, up.')
s.b('two', 'narrate', text='Star number two, high in the sky.')
s.b('bird-bows', 'release', text='The bird tucks its head under its wing.')
s.b('dim1', 'lamp', level=0.8)
s.b('sea', 'scenery', set='sea')
s.b('sea-rest', 'moth', mode='resting', restU=-0.4, restV=0.08)
s.b('sea-text', 'narrate', text='Star number three is hiding in the sea. Can you see it, shining in the water?')
s.b('want-fish', 'request', shape='fish', alt='dog', outlineU=0, outlineV=-0.18, text='Make a fish: a flat hand, fingers together. Swim to star number three.')
s.b('fish-ride', 'moth', mode='riding')
s.b('fish-carry', 'carry', toU=0.3, text='Swim, swim, swim.')
s.b('three', 'narrate', text='Star number three. It was the moon all along, winking.')
s.b('fish-bows', 'release', text='The fish yawns a big bubbly yawn.')
s.b('dim2', 'lamp', level=0.6)
s.b('clear', 'scenery', set='none')
s.b('mo-centre', 'moth', mode='resting', restU=0, restV=0.1)
s.b('falling', 'narrate', text='Oh! A little star is falling. Quick, catch it.')
s.b('want-cup', 'request', shape='cup', text='Cup your hands together, softly.')
s.b('four', 'narrate', text='Star number four, warm in your hands.')
s.b('letgo', 'letgo', text='Now open your hands, and let it go back to the sky.')
s.b('free', 'release', text='Up it goes...')
s.b('finale', 'finale', seconds=4)
s.b('five', 'narrate', text='And star number five is you, {child|little one}. The brightest one of all.')
s.b('dim3', 'lamp', level=0.35)
s.b('goodnight', 'narrate', text='Close your eyes now. Goodnight, little star.')
s.b('mo-sleep', 'moth', mode='resting', restU=0.1, restV=0.15)
s.b('the-end', 'chapter', chapter='The End', text='The End')
s.b('end', 'end', text='The End')
s.write('counting-stars')

library = {'stories': [
    {'id': 'the-moth', 'title': 'The Moth Who Borrowed Light', 'script': 'story/the-moth.story.json', 'minutes': 20, 'blurb': 'Help Mo find her glow, chapter by chapter.'},
    {'id': 'across-the-sea', 'title': 'Goodnight Across the Sea', 'script': 'story/across-the-sea.story.json', 'minutes': 5, 'blurb': 'Mo carries a goodnight from far away.'},
    {'id': 'the-slow-letter', 'title': 'The Letter That Took the Slow Way', 'script': 'story/the-slow-letter.story.json', 'minutes': 5, 'blurb': 'A snail, a swan and a deer carry a letter home.'},
    {'id': 'the-brave-little-dog', 'title': 'The Brave Little Dog', 'script': 'story/the-brave-little-dog.story.json', 'minutes': 5, 'blurb': 'Being brave while someone is far away.'},
    {'id': 'counting-stars', 'title': 'Counting Stars', 'script': 'story/counting-stars.story.json', 'minutes': 3, 'blurb': 'A calm count to five, for the littlest ones.'},
]}
(ROOT / 'library.json').write_text(json.dumps(library, indent=2) + '\n')
print('wrote', len(library['stories']), 'stories')
