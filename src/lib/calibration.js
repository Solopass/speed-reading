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

// Two further calibration reads. The baseline is the mean of up to three, so
// one rushed or distracted run does not set the zero point on its own. Same
// rules as the first: dense with concrete specifics, questions on details.
const CANAL_PASSAGE = {
    id: 'baseline-2',
    isCalibration: true,
    title: 'Baseline Test — Passage 2',
    text: `The first serious attempt to cut a canal across Panama was French. In 1881 a company led by Ferdinand de Lesseps, fresh from building the Suez Canal, began digging a sea-level channel through the jungle. Suez had been dug through flat, dry desert; Panama offered mountains, a river that flooded violently in the rainy season, and mosquitoes. Disease and landslides killed workers by the thousand, and in 1889 the company went bankrupt.

The United States took over the project in 1904 and changed the plan. Rather than digging all the way down to sea level, American engineers dammed the Chagres River at Gatun, creating an artificial lake that ships would cross partway through the journey. Sets of locks at each end would lift vessels about twenty-six metres up to the lake and lower them back down on the other side.

Before much digging could succeed, the workforce had to survive. William Gorgas, the army doctor in charge of sanitation, accepted the then-recent finding that mosquitoes spread yellow fever and malaria. His teams drained standing water, fumigated buildings and screened windows, and yellow fever was gone from the canal zone within a few years.

The hardest excavation was the Culebra Cut, a channel blasted through the continental divide, where repeated slides kept refilling what had been dug. Under the chief engineer George Goethals, the canal opened on 15 August 1914, cutting thousands of kilometres off the sea route between the Atlantic and the Pacific.`,
    questions: [
        {
            q: 'What had Ferdinand de Lesseps built before attempting Panama?',
            options: ['The Suez Canal', 'The Kiel Canal', 'The Erie Canal', 'The Corinth Canal'],
            answer: 0
        },
        {
            q: 'How did the American plan differ from the French one?',
            options: [
                'It used a dammed lake and locks instead of a sea-level channel',
                'It followed a shorter route through Nicaragua',
                'It dug a deeper sea-level channel with steam shovels',
                'It used a railway to carry ships over the divide'
            ],
            answer: 0
        },
        {
            q: 'About how far did the locks lift ships?',
            options: ['About twenty-six metres', 'About four metres', 'About ninety metres', 'About two hundred metres'],
            answer: 0
        },
        {
            q: 'What was William Gorgas responsible for?',
            options: ['Sanitation and disease control', 'Designing the locks', 'Financing the American effort', 'Surveying the Culebra Cut'],
            answer: 0
        },
        {
            q: 'What kept undoing progress at the Culebra Cut?',
            options: ['Repeated landslides', 'Flooding from the Pacific tides', 'Strikes by the workforce', 'Earthquakes along the divide'],
            answer: 0
        }
    ]
};

const PENICILLIN_PASSAGE = {
    id: 'baseline-3',
    isCalibration: true,
    title: 'Baseline Test — Passage 3',
    text: `In September 1928 Alexander Fleming returned from a holiday to his laboratory at St Mary's Hospital in London and began sorting through culture plates of Staphylococcus bacteria he had left stacked on a bench. On one of them a mould had grown, and around it the bacterial colonies had dissolved. Fleming identified the mould as a Penicillium, named the substance it released penicillin, and published his observations the following year. He could not, however, purify it in useful quantities, and for about a decade it remained a laboratory curiosity.

The work was taken up at Oxford in 1939 by Howard Florey and Ernst Chain, with the biochemist Norman Heatley devising ways to extract and concentrate the drug. In 1940 they infected eight mice with lethal streptococci and treated four of them with penicillin. The treated mice survived; the untreated ones died.

The first human patient, in 1941, was a police constable named Albert Alexander, whose infection had begun with a scratch from a rose thorn. He improved dramatically over several days, but the supply ran out — the team had even recovered penicillin from his urine to reuse it — and he relapsed and died.

Mass production was solved in the United States, where a government laboratory in Peoria, Illinois, found that a mould growing on a cantaloupe bought at a local market yielded far more penicillin than Fleming's strain. In 1945 Fleming, Florey and Chain shared the Nobel Prize in Physiology or Medicine.`,
    questions: [
        {
            q: 'What was Fleming growing on the plate the mould contaminated?',
            options: ['Staphylococcus bacteria', 'Streptococcus bacteria', 'Yeast cultures', 'Tuberculosis bacteria'],
            answer: 0
        },
        {
            q: 'In the Oxford mouse experiment, how many mice received penicillin?',
            options: ['Four of eight', 'All eight', 'Two of six', 'Ten of twenty'],
            answer: 0
        },
        {
            q: 'What was Norman Heatley\'s contribution?',
            options: ['Ways to extract and concentrate the drug', 'Discovering the original mould', 'Treating the first patient', 'Running the American production lab'],
            answer: 0
        },
        {
            q: 'Why did the first patient die after improving?',
            options: ['The supply of penicillin ran out', 'He was allergic to the drug', 'The infection became resistant', 'He was given the wrong dose'],
            answer: 0
        },
        {
            q: 'Where did the high-yield mould used for mass production come from?',
            options: ['A cantaloupe from a market in Peoria', 'Soil samples from an Oxford garden', 'Fleming\'s original plate', 'Bread mould from a London bakery'],
            answer: 0
        }
    ]
};

/** All baseline passages, in the order they are offered. */
export const CALIBRATION_PASSAGES = [CALIBRATION_PASSAGE, CANAL_PASSAGE, PENICILLIN_PASSAGE];
