// Ships with the app so the speed-push protocol works before any API key is set.
// Section A is drilled three times at escalating speed; section B is the unseen
// material that gets measured, so every question is answerable from B alone.
export const PUSH_DRILL_PASSAGE = {
    id: 'builtin-push',
    title: 'The Broad Street Pump',
    sectionA: `In the last week of August 1854, cholera broke out in Soho, London. Within ten days more than five hundred people living within a few streets of one another were dead. Whole households were emptied at once. Those who could afford to leave fled, and the district's population fell by roughly three quarters inside a week.

The prevailing explanation was miasma — the belief that disease travelled through foul air rising from rotting matter. It was not an unreasonable theory. Victorian Soho stank, its cellars stood flooded with sewage, and the sick were concentrated exactly where the smell was worst. The correlation was real, and it pointed the wrong way.

John Snow, a physician who had made his reputation administering chloroform, thought the mechanism was wrong. He had argued for years that cholera was waterborne, entering through the gut rather than the lungs. The Soho outbreak gave him a chance to test the idea, and he began walking the district, recording where each of the dead had lived.

What he produced was a map. Each death was marked as a black bar against the address where it occurred, and the bars stacked into a dense cluster around a single point: the public water pump on Broad Street. Deaths thinned with distance from it, but unevenly, and the exceptions carried the argument. The workhouse on Poland Street, hemmed in on every side by the outbreak, had its own well and lost only a handful of its five hundred inmates. The brewery on Broad Street lost nobody at all; its workers drank beer, and it drew water from a private supply.`,
    sectionB: `One death sat miles away, in Hampstead. A widow who had once lived on Broad Street had grown fond of the water there and kept a large bottle of it carted out to her. She drank from it at the end of August and was dead of cholera two days later. Her niece, visiting from Islington, drank the same water and died as well. Neither woman had been anywhere near Soho.

On the seventh of September, Snow put his evidence to the Board of Guardians of St James's parish. He did not convince them of his theory, but he convinced them to act, and the following day the handle was removed from the Broad Street pump. The outbreak was already subsiding by then, since most of the neighbourhood had fled, and Snow never claimed the removal had ended it. His point was narrower and more durable: the water, not the air, was carrying the disease.

The final piece came from Henry Whitehead, a local curate who set out to disprove Snow and ended up confirming him. Searching parish records, Whitehead traced the outbreak back to a house at 40 Broad Street, where an infant named Frances Lewis had fallen ill days before anyone else. Her mother had soaked the child's nappies in a bucket and emptied it into the cesspit at the front of the house. An inspection found the cesspit's brickwork decayed and leaking, less than a metre from the pump's well.

Snow died in 1858, aged forty-five, his theory still disputed. The medical establishment did not abandon miasma for another decade. But the method outlived him: map the cases, find the shared exposure, test the exceptions. It is the foundation of modern epidemiology, and it was assembled on foot in ten days, in a street where five hundred people had just died.`,
    questions: [
        {
            q: 'Where was the woman who died despite living miles from Soho?',
            options: ['Hampstead', 'Islington', 'Whitechapel', 'Greenwich'],
            answer: 0
        },
        {
            q: 'What did Henry Whitehead originally set out to do?',
            options: ['Disprove Snow', 'Assist Snow with his map', 'Close the pump', 'Record the parish death toll'],
            answer: 0
        },
        {
            q: 'Who was traced as the outbreak’s first case?',
            options: ['An infant named Frances Lewis', 'A brewery worker on Broad Street', 'A widow newly arrived from Hampstead', 'A inmate of the Poland Street workhouse'],
            answer: 0
        },
        {
            q: 'How did the infection reach the well?',
            options: [
                'Nappy-washing water was emptied into a leaking cesspit beside it',
                'Sewage from flooded cellars ran downhill into it',
                'A cracked sewer main discharged directly into the shaft',
                'Contaminated beer from the brewery was poured away nearby'
            ],
            answer: 0
        },
        {
            q: 'Why did Snow never claim that removing the pump handle ended the outbreak?',
            options: [
                'It was already subsiding, because most of the neighbourhood had fled',
                'The handle was replaced within a day by the parish',
                'He believed a second pump was also contaminated',
                'He had left London before the handle was removed'
            ],
            answer: 0
        }
    ]
};
