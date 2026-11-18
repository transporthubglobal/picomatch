'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const { isMatch, makeRe } = require('..');

describe('options.maxExtglobRecursion', () => {
  it('should literalize risky repeated extglobs by default', () => {
    assert.strictEqual(
      makeRe('+(a|aa)').source,
      '^(?:\\+\\(a\\|aa\\))$'
    );
    assert.strictEqual(
      makeRe('+(*|?)').source,
      '^(?:\\+\\(\\*\\|\\?\\))$'
    );
    assert.strictEqual(
      makeRe('+(+(a))').source,
      '^(?:\\+\\(\\+\\(a\\)\\))$'
    );
    assert.strictEqual(
      makeRe('*(+(a))').source,
      '^(?:\\*\\(\\+\\(a\\)\\))$'
    );

    assert(!isMatch('a'.repeat(20) + 'b', '+(a|aa)'));
    assert(!isMatch('a'.repeat(12) + '!', '+(+(a))'));
  });

  it('should safely rewrite single-branch repeated extglobs containing wildcards', () => {
    assert.strictEqual(makeRe('+(*)').source, '^(?:(?=.)[^/]*?)$');
    assert.strictEqual(makeRe('+(*a)').source, '^(?:(?=.)[^/]*?a)$');
    assert.strictEqual(makeRe('+(a*)').source, '^(?:(?=.)a[^/]*?)$');

    const adversarialCases = [
      ['a'.repeat(32) + 'y', '+(*)z'],
      ['a'.repeat(32) + 'y', '+(*a)z'],
      ['a'.repeat(50000) + 'y', '+(*a*)z'],
      ['a'.repeat(32) + '/', '+(*)'],
      ['a'.repeat(32) + '!', '+(*a)'],
      ['a'.repeat(50000) + 'y', '+(*a*b)'],
      ['a'.repeat(50000) + 'y', '+(a*b*c)'],
      ['a'.repeat(50000) + 'y', '+(@(*a))'],
      ['a'.repeat(50000) + 'y', '+(?(*a))']
    ];

    for (const [input, pattern] of adversarialCases) {
      const script = `const { isMatch } = require('./');\nisMatch(${JSON.stringify(input)}, ${JSON.stringify(pattern)});`;
      const result = spawnSync(process.execPath, ['-e', script], {
        encoding: 'utf8',
        timeout: 3000
      });
      assert.strictEqual(result.error, undefined, `adversarial case timed out: ${pattern}`);
      assert.strictEqual(result.status, 0, result.stderr);
    }

    assert(isMatch('abc', '+(*)'));
    assert(isMatch('bba', '+(*a)'));
    assert(isMatch('a', '+(*a)'));
    assert(!isMatch('bbb', '+(*a)'));
    assert(isMatch('+(*a*)', '+(*a*)'));
    assert(!isMatch('baac', '+(*a*)'));
    assert(isMatch('abc', '+(a*)'));
    assert(!isMatch('bca', '+(a*)'));
    assert(isMatch('abc', '+(*)c'));

    assert(isMatch('foo/bar', '+(foo/*)'));
    assert(isMatch(' xa', '+( *a)'));
    assert(!isMatch('xa', '+( *a)'));

    // Wildcards nested inside another extglob are conservatively literalized.
    assert.strictEqual(makeRe('+(@(*a))').source, '^(?:\\+\\(@\\(\\*a\\)\\))$');
    assert.strictEqual(makeRe('+(?(*a))').source, '^(?:\\+\\(\\?\\(\\*a\\)\\))$');

    // Multiple independent wildcard runs are conservatively literalized.
    assert(isMatch('+(*a*b)', '+(*a*b)'));
    assert(!isMatch('ab', '+(*a*b)'));
    assert(isMatch('+(a*b*c)', '+(a*b*c)'));
    assert(!isMatch('abcabc', '+(a*b*c)'));

    assert(isMatch('a/b', '+(a*)', { bash: true }));
    assert(!isMatch('a/b', '+(a*)'));

    assert(isMatch('x', 'x*(a*)'));
    assert(isMatch('x', 'x*(*)'));
    assert(isMatch('***', '+(\\*)'));
    assert(isMatch('***', '+("*")'));
  });

  it('should preserve non-risky extglobs by default', () => {
    assert(isMatch('abcabc', '+(abc)'));
    assert(isMatch('foobar', '*(foo|bar)'));
    assert(isMatch('a', '(a|@(b|c)|d)'));
    assert(isMatch('fffooo', '*(*(f)*(o))'));
    assert(isMatch('abc', '+(*)c'));
  });

  it('should allow limited nested repeated extglobs when configured', () => {
    assert.strictEqual(
      makeRe('+(+(a))', { maxExtglobRecursion: 1 }).source,
      '^(?:(?=.)(?:(?:a)+)+)$'
    );
    assert.strictEqual(
      makeRe('*(+(a))', { maxExtglobRecursion: 1 }).source,
      '^(?:(?=.)(?:(?:a)+)*)$'
    );

    assert(isMatch('aaa', '+(+(a))', { maxExtglobRecursion: 1 }));
    assert(isMatch('aaa', '*(+(a))', { maxExtglobRecursion: 1 }));
  });

  it('should still block ambiguous repeated alternation when recursion is allowed', () => {
    assert.strictEqual(
      makeRe('+(a|aa)', { maxExtglobRecursion: 1 }).source,
      '^(?:\\+\\(a\\|aa\\))$'
    );
    assert.strictEqual(
      makeRe('+(*|?)', { maxExtglobRecursion: 1 }).source,
      '^(?:\\+\\(\\*\\|\\?\\))$'
    );
  });

  it('should rewrite risky repeated extglobs embedded in larger patterns', () => {
    assert.strictEqual(
      makeRe('foo/+(a|aa)/bar').source,
      '^(?:foo\\/\\+\\(a\\|aa\\)\\/bar)$'
    );
    assert.strictEqual(
      makeRe('x+(a|aa)y').source,
      '^(?:x\\+\\(a\\|aa\\)y)$'
    );

    assert(isMatch('foo/+(a|aa)/bar', 'foo/+(a|aa)/bar'));
    assert(!isMatch('foo/aa/bar', 'foo/+(a|aa)/bar'));
    assert(isMatch('x+(a|aa)y', 'x+(a|aa)y'));
    assert(!isMatch('xaay', 'x+(a|aa)y'));
  });

  it('should rewrite star-only repeated extglobs embedded in larger patterns', () => {
    assert.strictEqual(
      makeRe('pre*(*(f)*(o))post').source,
      '^(?:pre[fo]*post)$'
    );

    assert(isMatch('prefoopost', 'pre*(*(f)*(o))post'));
  });

  it('should rewrite star-only repeated extglobs', () => {
    assert.strictEqual(
      makeRe('*(*(f))').source,
      '^(?:(?=.)f*)$'
    );

    assert(isMatch('fff', '*(*(f))'));
  });

  it('should rewrite multi-branch star-only repeated extglobs without dropping branches', () => {
    // Regression: the risky-extglob rewrite previously emitted only the first
    // branch, so `+(*(a)|*(b))` collapsed to `a*` and silently stopped matching
    // any string containing `b`. The safe rewrite must preserve every branch.
    assert.strictEqual(
      makeRe('+(*(a)|*(b))').source,
      '^(?:(?=.)[ab]*)$'
    );
    assert.strictEqual(
      makeRe('*(*(a)|c)').source,
      '^(?:(?=.)[ac]*)$'
    );

    for (const str of ['a', 'b', 'ab', 'ba', 'aabb']) {
      assert(isMatch(str, '+(*(a)|*(b))'), `expected to match ${str}`);
    }
    assert(!isMatch('c', '+(*(a)|*(b))'));

    for (const str of ['c', 'a', 'aca', 'cac']) {
      assert(isMatch(str, '*(*(a)|c)'), `expected to match ${str}`);
    }
    assert(!isMatch('d', '*(*(a)|c)'));
  });

  it('should preserve capture behavior for rewritten repeated extglobs', () => {
    const embedded = makeRe('foo/+(a|aa)/bar', { capture: true });
    assert.strictEqual(embedded.source, '^(?:foo\\/\\+\\(a\\|aa\\)\\/bar)$');
    assert.deepStrictEqual(
      Array.from(embedded.exec('foo/+(a|aa)/bar')),
      ['foo/+(a|aa)/bar']
    );

    const simplified = makeRe('*(*(f)*(o))', { capture: true });
    assert.strictEqual(simplified.source, '^(?:(?=.)([fo]*))$');
    assert.deepStrictEqual(
      Array.from(simplified.exec('fffooo')),
      ['fffooo', 'fffooo']
    );
  });

  it('should only rewrite the risky repeated extglob when adjacent extglobs are present', () => {
    assert.strictEqual(
      makeRe('+(a|aa)@(x)').source,
      '^(?:\\+\\(a\\|aa\\)(x))$'
    );

    assert(isMatch('+(a|aa)x', '+(a|aa)@(x)'));
    assert(!isMatch('aaax', '+(a|aa)@(x)'));
  });
  it('should disable the safeguard when maxExtglobRecursion is false', () => {
    assert(
      /\(\?:a\|aa\)\+/.test(
        makeRe('+(a|aa)', { maxExtglobRecursion: false }).source
      )
    );
    assert(
      /\(\?:\(\?:a\)\+\)\+/.test(
        makeRe('+(+(a))', { maxExtglobRecursion: false }).source
      )
    );
  });
});
