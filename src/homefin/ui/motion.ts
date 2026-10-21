// Small, shared motion: rows that ease in as they scroll into view. Page fades and the rest are
// plain CSS (motion.scss). Everything stays still for people who ask for reduced motion.
import './motion.scss';

const REVEAL_SELECTOR = '.verticalSection';

function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Fade rows in as they arrive on screen. Rows fill in asynchronously, so a row is only picked up
 * once it has content; returns a function that stops watching.
 */
export function revealRows(root: HTMLElement) {
    if (prefersReducedMotion() || typeof IntersectionObserver === 'undefined') return () => undefined;

    const seen = new WeakSet<Element>();
    const io = new IntersectionObserver(entries => {
        for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
        }
    }, { rootMargin: '0px 0px -6% 0px' });

    let queued = false;
    const scan = () => {
        queued = false;
        for (const row of root.querySelectorAll(REVEAL_SELECTOR)) {
            if (seen.has(row) || !row.childElementCount || row.classList.contains('hide')) continue;
            seen.add(row);
            row.classList.add('hfReveal');
            io.observe(row);
        }
    };
    const mo = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(scan);
    });
    mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    scan();

    return () => {
        io.disconnect();
        mo.disconnect();
    };
}
