import { proseStyle } from './ReadingSurface';
import { normalizeReading } from '../lib/readingStyle';

const splitParagraphs = (text) => text.trim().split(/\n\s*\n/).filter(p => p.trim().length > 0);

/**
 * Bionic reading emboldens the opening of each word as an artificial fixation
 * point. The proportion is adjustable because the right amount varies a lot by
 * reader — too much and the whole line reads as bold, too little and there is
 * no anchor.
 */
const bionic = (word, key, strength) => {
    if (word.length <= 1) return <span key={key}>{word} </span>;
    const cut = Math.max(1, Math.round(word.length * strength));
    return (
        <span key={key}>
            <strong style={{ color: 'var(--reading-fg)', fontWeight: 700 }}>{word.slice(0, cut)}</strong>
            <span style={{ opacity: 0.75 }}>{word.slice(cut)}</span>{' '}
        </span>
    );
};

/** Renders passage text, preserving the author's paragraph breaks. */
export default function PassageText({ text, bionicReading, reading }) {
    const settings = normalizeReading(reading);

    return (
        <div className="mx-auto" style={{ maxWidth: 'var(--reading-max-width)' }}>
            {splitParagraphs(text).map((para, index) => (
                <p
                    key={index}
                    style={{ ...proseStyle, marginBottom: 'var(--reading-paragraph-gap)' }}
                >
                    {bionicReading
                        ? para.split(/\s+/).map((word, i) => bionic(word, i, settings.bionicStrength))
                        : para}
                </p>
            ))}
        </div>
    );
}
