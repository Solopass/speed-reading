// Ships with the app so a baseline can be taken before any API key is set.
// Deliberately dense with concrete details (dates, counts, centuries) so the
// questions test recall of this passage rather than general knowledge.
export const CALIBRATION_PASSAGE = {
    id: 'baseline',
    isCalibration: true,
    title: 'Baseline Test',
    text: `In 1901, sponge divers sheltering from a storm off the Greek island of Antikythera found a Roman-era shipwreck on the seabed. Among the bronze statues and pottery they raised was a corroded lump of metal that then sat largely ignored in an Athens museum for decades. It is now considered the most sophisticated object surviving from the ancient world.

The Antikythera mechanism, as it came to be called, is a geared bronze device roughly the size of a shoebox. About thirty of its gears survive, and the largest carries more than two hundred teeth, each one cut by hand. Turning a crank on its side drove a system of dials that tracked the positions of the sun and moon, reproduced the irregular speed of the moon's orbit across the sky, and predicted eclipses decades in advance. One dial counted down the four-year cycle of the games held at Olympia.

Its age is debated, but most estimates place its construction in the second or first century BCE. Nothing of comparable complexity appears in the archaeological record for well over a thousand years afterwards; geared clockwork of similar intricacy does not reappear in Europe until the fourteenth century.

Much of what is known came not from the surface of the fragments but from inside them. Beginning in the 2000s, high-resolution X-ray computed tomography let researchers read inscriptions sealed within the corrosion — a compressed instruction manual, describing what the dials showed and how to read them.`,
    questions: [
        {
            q: 'What else did the divers raise from the wreck alongside the mechanism?',
            options: ['Bronze statues and pottery', 'Gold coins and glassware', 'Marble columns and amphorae of wine', 'Iron tools and coils of rope'],
            answer: 0
        },
        {
            q: 'How many teeth does the largest surviving gear carry?',
            options: ['More than two hundred', 'About fifty', 'Exactly thirty', 'More than a thousand'],
            answer: 0
        },
        {
            q: 'What did the four-year dial count down to?',
            options: ['The games held at Olympia', 'The Roman census', 'Leap years in the Egyptian calendar', 'The return of a comet'],
            answer: 0
        },
        {
            q: 'When does the passage say comparably intricate geared clockwork reappears in Europe?',
            options: ['The fourteenth century', 'The ninth century', 'The sixteenth century', 'The first century CE'],
            answer: 0
        },
        {
            q: 'Roughly how long after its recovery were the sealed internal inscriptions finally read?',
            options: ['About a century', 'Within five years', 'About thirty years', 'They have never been read'],
            answer: 0
        }
    ]
};
