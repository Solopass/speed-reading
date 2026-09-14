// Runs the app's real prompt specs against local Ollama models and reports
// latency plus whether the reply survives the app's own validation.
// Usage: bun scripts/eval-ollama.mjs sol-fast gemma4:12b
import { passageSpec, pushSpec, coachSpec, verifySpec, dropGuessableQuestions } from '../src/lib/ai.js';
import { normalizeQuestions } from '../src/lib/quiz.js';
import { generateJson } from '../src/lib/ollama.js';

const models = process.argv.slice(2);
const baseUrl = process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434';
const words = (s) => (typeof s === 'string' ? s.trim().split(/\s+/).filter(Boolean).length : 0);
const time = async (fn) => { const t = performance.now(); try { return { ok: true, value: await fn(), s: (performance.now() - t) / 1000 }; } catch (e) { return { ok: false, error: e.message, s: (performance.now() - t) / 1000 }; } };

for (const model of models) {
    console.log(`\n================ ${model}`);
    const opts = { baseUrl, model };

    // warm-up so load time doesn't count against the first task
    const warm = await time(() => generateJson({ prompt: 'Reply with {"ok": true}' }, opts));
    console.log(`load/warm-up: ${warm.s.toFixed(1)}s ${warm.ok ? '' : 'FAILED: ' + warm.error}`);

    const passage = await time(() => generateJson(passageSpec({ topic: 'the 1854 Broad Street cholera outbreak', difficulty: 6 }), opts));
    if (passage.ok) {
        const qs = normalizeQuestions(passage.value.questions);
        console.log(`passage: ${passage.s.toFixed(1)}s | title="${passage.value.title}" | ${words(passage.value.text)} words (want 200-300) | questions raw=${passage.value.questions?.length} usable=${qs.length}`);
        console.log(`  first question: ${qs[0]?.q}`);
        const check = await time(() => generateJson(verifySpec({ questions: qs }), opts));
        if (check.ok) {
            const r = dropGuessableQuestions(qs, check.value.answers);
            console.log(`question check: ${check.s.toFixed(1)}s | answers=${JSON.stringify(check.value.answers)} | dropped=${r.dropped} applied=${r.applied}`);
        } else console.log(`question check FAILED (${check.s.toFixed(1)}s): ${check.error}`);
    } else console.log(`passage FAILED (${passage.s.toFixed(1)}s): ${passage.error}`);

    const push = await time(() => generateJson(pushSpec({ topic: 'how bridges handle wind', difficulty: 5 }), opts));
    if (push.ok) {
        console.log(`push drill: ${push.s.toFixed(1)}s | A=${words(push.value.sectionA)} B=${words(push.value.sectionB)} words (want ~280 each) | usable questions=${normalizeQuestions(push.value.questions).length}`);
    } else console.log(`push drill FAILED (${push.s.toFixed(1)}s): ${push.error}`);

    const coach = await time(() => generateJson(coachSpec({
        stats: { targetWpm: 420, highestWpm: 510, sessionsCompleted: 12, streak: 4 },
        effectiveWpm: 350, comprehension: 78, scoredCount: 9, recent: '380wpm 80%, 400wpm 80%, 420wpm 60%, 410wpm 80%'
    }), opts));
    if (coach.ok) console.log(`coach: ${coach.s.toFixed(1)}s | grade=${coach.value.grade} | diagnosis ${words(coach.value.diagnosis)} words`);
    else console.log(`coach FAILED (${coach.s.toFixed(1)}s): ${coach.error}`);
}
