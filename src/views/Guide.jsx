
function Guide() {
    return (
        <div className="max-w-3xl mx-auto space-y-8 animate-in slide-in-from-bottom-4 pb-12">
            <div>
                <h1 className="text-3xl font-bold text-white">Training Guide</h1>
                <p className="text-slate-400 mt-2">The neuroscience and methodology behind the tools.</p>
            </div>

            <div className="prose prose-invert prose-purple max-w-none">
                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">The three speeds</h3>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        <strong>Raw WPM</strong> is how fast you actually moved through the words — measured from the clock, not from the speed dial, so pauses and punctuation pacing are accounted for.
                    </p>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        <strong>Effective WPM</strong> is raw speed × comprehension. Read at 1,000 WPM and score 50%, and your eWPM is 500 — the same as reading at 500 WPM with perfect retention. It is a measurement of a finished session and never something you set.
                    </p>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        <strong>Target WPM</strong> is the prescription: the speed the reader opens at next time. With Auto-Adaptive on, a perfect quiz climbs it 5%, one miss holds it steady, and worse than that backs it off 3–8%. Sessions without a quiz can’t move it, because nothing about your comprehension was measured.
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                        The baseline test sets your starting target from a passage read at your natural pace, so “+18% since baseline” means something. Without it, the 300 WPM default is just a guess about you. If you would rather drive it yourself, Settings lets you lock the target and raise it by hand — your scores are still recorded either way, so Effective WPM still tells you whether the speed is working.
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">The ceiling, honestly</h3>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        Worth knowing what you are aiming at. Typical adult reading runs 200–300 WPM; skilled readers reach 400–600 with
                        full comprehension. Above roughly 600–700 there is a physiological wall: a fixation lasts about a fifth of a second,
                        and you can only take in around 15–18 characters to the right of it. Past that point you are not reading every word —
                        you are sampling the page and inferring the rest.
                    </p>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        That is not a reason to aim low. Sampling fast is a real, trainable, genuinely useful skill — it is how you triage a
                        long report or find the one paragraph that matters. But it is a different skill from reading, with different
                        comprehension expectations, and the honest way to chase a number like 2,000 WPM is to know which of the two you are
                        practising.
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                        This is exactly what <strong>Effective WPM</strong> is for. Push your raw speed as hard as you like — eWPM will show
                        you where your own comprehension starts paying for it, rather than leaving you to guess. If your eWPM keeps climbing
                        at 900 WPM, that is real and the number proves it. If it peaks at 550 and falls, you have found your wall, and the
                        Analytics scatter shows you precisely where.
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">Retention checks</h3>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        A comprehension quiz taken straight after reading measures something closer to short-term memory than to
                        understanding. You can score well on a passage you will have entirely forgotten by Thursday, and a training app that
                        only ever quizzes you immediately will happily tell you that is progress.
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                        So every passage you finish comes back. Two days later, then a week, then three weeks, then two months, the questions
                        return with no text in front of you. Nothing about speed is recorded — a retention check measures only whether the
                        reading stuck. If your scores hold up as your speed climbs, the speed is real. If they collapse, you are moving your
                        eyes faster and not much else.
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">The Speed Push Drill</h3>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        This is the drill that produces the gains, and it is worth understanding why it works rather than just running it.
                        You read a section at your normal target pace, then the <em>same section</em> again at roughly twice that speed, then a
                        third time at roughly three times. Those two over-speed passes are not reading and are not meant to be — comprehension
                        collapses and that is fine.
                    </p>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        Then you read a section you have <em>not</em> seen, at 1.3× your target, and answer questions on it. That final read is
                        the only one measured. The reason it works is adaptation: after the fastest pass, your normal pace feels sluggish, and a
                        speed that would have felt frantic cold now feels manageable. You are recalibrating what “fast” means, not just
                        practising.
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                        Two rules make or break it. Never re-read during the over-speed passes — the whole point is breaking the regression
                        habit. And never let the drill flatter you: the questions are on the unseen section precisely so the third pass cannot
                        be mistaken for comprehension you did not have.
                    </p>
                    <p className="text-slate-300 leading-relaxed mt-4">
                        How hard those over-speed passes push is not fixed. Score well on the measured read and the overload creeps up; lose
                        retention and it backs off, the same way your target speed moves. The measured read itself always stays at 1.3×, so
                        one session stays comparable with the next. Settings shows the multipliers you are currently on.
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">Three reading modes</h3>
                    <ul className="space-y-4 text-slate-300 leading-relaxed">
                        <li>
                            <strong>RSVP</strong> flashes words at a fixed point. It removes eye movement entirely, which makes it the fastest
                            way to experience high speed and break subvocalisation — but you cannot RSVP a book, so it trains something you can
                            only use in here.
                        </li>
                        <li>
                            <strong>Paced</strong> keeps the text in normal layout and sweeps a cursor across each line at your target speed.
                            Your eyes still make real saccades and real fixations, so the skill transfers to a page. It is the mode to spend most
                            of your time in. The rule that makes it work: never go back. Regression — the unconscious flick to a phrase you
                            already passed — eats up to a sixth of reading time, and the pacer’s job is to make that impossible to hide from.
                        </li>
                        <li>
                            <strong>Natural</strong> applies no pacing at all and simply times you. It is the honest measurement of where you
                            actually are, and it is what the baseline test uses.
                        </li>
                    </ul>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">The RSVP Engine &amp; Subvocalization</h3>
                    <p className="text-slate-300 leading-relaxed mb-4">
                        The core tool is the RSVP (Rapid Serial Visual Presentation) Reader. By flashing words in the exact same spot, it eliminates the time your eyes spend physically moving across a page (saccades).
                    </p>
                    <p className="text-slate-300 leading-relaxed">
                        More importantly, by pushing the speed past 400 WPM, it forces you to stop <strong>subvocalizing</strong> (saying the words in your head). The auditory processing center of your brain is too slow to keep up, forcing your visual cortex to take over and process the words as abstract concepts, similar to how you recognize a stop sign instantly without “reading” the word STOP.
                    </p>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl mb-8">
                    <h3 className="text-xl font-bold text-white mb-4">Terms used here</h3>
                    <ul className="space-y-3 text-slate-300 leading-relaxed">
                        <li><strong className="text-white">Subvocalization:</strong> The internal speech or ’inner voice’ made when reading a word, which heavily bottlenecks reading speed.</li>
                        <li><strong className="text-white">Saccade:</strong> A rapid, jerky movement of the eye between fixation points while reading across a line of text.</li>
                        <li><strong className="text-white">Neuroplasticity:</strong> The brain’s ability to reorganize itself by forming new neural connections in response to learning.</li>
                        <li><strong className="text-white">Fixation:</strong> The brief pause of the eye on a specific word or group of words to process visual information.</li>
                        <li><strong className="text-white">Peripheral Span:</strong> The number of words or characters you can clearly perceive outside your direct point of focus.</li>
                        <li><strong className="text-white">Regression:</strong> The unconscious habit of re-reading text you have already passed over, breaking momentum.</li>
                    </ul>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-6 md:p-8 rounded-3xl">
                    <h3 className="text-xl font-bold text-white mb-4">Phase 4 Modules Explained</h3>
                    <ul className="space-y-4 text-slate-300">
                        <li><strong>Bionic Reading:</strong> Artificial fixation points that guide your eyes through standard text paragraphs by bolding the start of words.</li>
                        <li><strong>Punctuation Pacing:</strong> Humans need a split-second at the end of a sentence to package the concept. This adds a microscopic delay to commas and periods in RSVP mode.</li>
                        <li><strong>Audio Sync:</strong> Speaks each chunk as it flashes, via the Web Speech API. Useful as a scaffold below ~400 WPM; above that speech can’t keep pace and truncates — which is the point at which you want to be training without it anyway.</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

export default Guide;
