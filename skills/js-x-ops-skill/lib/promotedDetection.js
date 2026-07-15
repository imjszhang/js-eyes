'use strict';

/**
 * Conservatively identify promoted X posts from explicit, user-visible labels.
 *
 * X now renders data-testid="placementTracking" on organic posts too, so that
 * node is only useful as context and must never be treated as proof by itself.
 * Keep false positives low: downstream collectors can tolerate an occasional
 * ad much better than silently dropping an entire organic timeline.
 */
function isPromotedTweet(article) {
  if (!article || typeof article.querySelector !== 'function') return false;

  const explicitLabel = /^(?:promoted|ad|推广|广告)$/i;
  const labelText = (node) => String(
    node && (node.getAttribute && node.getAttribute('aria-label'))
      || (node && node.textContent)
      || '',
  ).trim();

  const labelled = article.querySelector(
    '[aria-label="Promoted"], [aria-label="Ad"], [aria-label="推广"], [aria-label="广告"]',
  );
  if (labelled) return true;

  const socialContext = article.querySelector('[data-testid="socialContext"]');
  if (socialContext && explicitLabel.test(labelText(socialContext))) return true;

  // placementTracking is present on current organic posts. Only inspect labels
  // when it exists; never classify from this empty overlay alone.
  if (!article.querySelector('[data-testid="placementTracking"]')) return false;

  const tweetText = article.querySelector('[data-testid="tweetText"]');
  const userName = article.querySelector('[data-testid="User-Name"]');
  const candidates = typeof article.querySelectorAll === 'function'
    ? article.querySelectorAll('span, [dir="auto"]')
    : [];
  for (const candidate of candidates) {
    if (tweetText && typeof tweetText.contains === 'function' && tweetText.contains(candidate)) continue;
    if (userName && typeof userName.contains === 'function' && userName.contains(candidate)) continue;
    if (explicitLabel.test(labelText(candidate))) return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isPromotedTweet };
}
