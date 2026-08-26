/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

import type { BooksDbBookData } from '$lib/data/database/books-db/versions/books-db';
import parseCss from '../css-parser/css-parser';
import stringifyCss from '../css-parser/css-stringify';
import type { CssTree, Declaration, Rule } from '../css-parser/types';

const htmlRegex = /\s?html\s?/gi;
const bodyRegex = /\s?body\s?/gi;

/**
 * A publisher stylesheet is decoration. The text is the book.
 *
 * parseCss throws on anything it does not understand — an unterminated
 * comment, a missing brace, `@layer`, native nesting — and this runs inside
 * the observable that loads the book, with no catch anywhere above it. The
 * result was a **blank page**: no error, no message, no hint that the problem
 * was one stray `/*` in a stylesheet the reader never sees. Verified by
 * feeding a book whose only defect was an unterminated comment.
 *
 * So: keep the book. The reader's own theme still applies, so a book that
 * loses its publisher CSS is plain, not broken. The reason goes to the log
 * (surfaced by the report dialog) rather than a modal — it happens at open
 * time, the reader cannot act on it, and a dialog on every open would be
 * worse than the missing styling.
 */
function parseBookCss(styleSheet: string): CssTree | undefined {
  try {
    return parseCss(styleSheet);
  } catch (error) {
    console.warn(
      '[format-style-sheet] 样式表解析失败，本书按无样式渲染：',
      error instanceof Error ? error.message : error
    );
    return undefined;
  }
}

export default function formatStyleSheet(bookData: BooksDbBookData, parentSelector: string) {
  const cssTree = parseBookCss(bookData.styleSheet);
  if (!cssTree) {
    return stringifyCss({
      stylesheet: { rules: [getGeckoBrSolutionRule()] },
      type: 'stylesheet'
    });
  }

  const newRules = cssTree.stylesheet.rules
    .filter((r) => r.type === 'rule')
    .filter((r) => !r.selectors.some((s) => htmlRegex.test(s) || bodyRegex.test(s)));

  newRules.forEach((rule) => {
    const newDeclarations: Record<string, string> = {};

    rule.declarations = rule.declarations.filter(
      (d) => !/line-height$/.test(d.property) && !/text-indent$/.test(d.property)
    );

    const lineBreakFormatter = new LineBreakFormatter(rule.declarations, newDeclarations);

    rule.declarations.forEach((declaration) => {
      assignKeyValToObj(newDeclarations, convertPrefixedDeclaration(declaration));
      assignKeyValToObj(newDeclarations, convertFontFamily(declaration));
      assignKeyValToObj(newDeclarations, lineBreakFormatter.convert(declaration));
      // Might also want to handle margin conversion
    });

    Object.entries(newDeclarations).forEach(([property, value]) => {
      rule.declarations.push({
        type: 'declaration',
        property,
        value
      });
    });

    rule.declarations = rule.declarations.filter((d) => !/writing-mode\s*$/.test(d.property));
  });

  newRules.push(getGeckoBrSolutionRule());

  newRules.forEach((rule) => {
    rule.selectors = encapsulatedSelectors(rule.selectors, parentSelector);
  });

  return stringifyCss({
    stylesheet: {
      rules: newRules
    },
    type: 'stylesheet'
  });
}

function encapsulatedSelectors(selectors: string[], parentSelector: string) {
  return selectors.map((selector) => `${parentSelector} ${selector}`);
}

function assignKeyValToObj(
  obj: Record<string, string>,
  keyValObj:
    | {
        key: string;
        value: string;
      }
    | undefined
) {
  if (keyValObj) {
    obj[keyValObj.key] = keyValObj.value;
  }
  return obj;
}

function convertPrefixedDeclaration(declaration: Declaration) {
  const regexResult = /(?:(?:-epub-)|(?:-webkit-))(.+)/i.exec(declaration.property);
  if (regexResult) {
    return {
      key: regexResult[1],
      value: declaration.value
    };
  }
  return undefined;
}

function convertFontFamily(declaration: Declaration) {
  if (declaration.property === 'font-family') {
    let newValue: string = declaration.value;
    if (newValue.includes('sans-serif')) {
      newValue = `var(--font-family-sans-serif, 'Noto Sans SC', 'Noto Sans JP', sans-serif)`;
    } else if (newValue.includes('serif')) {
      newValue = `var(--font-family-serif, 'Noto Sans SC', 'Noto Serif JP', serif)`;
    }
    return {
      key: declaration.property,
      value: newValue
    };
  }
  return undefined;
}

class LineBreakFormatter {
  private hasLineBreakDefined?: boolean | undefined;

  constructor(
    private ruleDeclarations: Declaration[],
    private newDeclarations: Readonly<Record<string, string>>
  ) {}

  convert(declaration: Declaration) {
    if (
      /(?:(?:-epub-)|(?:-webkit-))?word-break$/i.exec(declaration.property) &&
      declaration.value === 'break-all'
    ) {
      if (this.hasLineBreakDefined === undefined) {
        this.hasLineBreakDefined = this.ruleDeclarations.some(
          (d) => d.type === 'declaration' && d.property === 'line-break'
        );
      }
      if (!this.hasLineBreakDefined && !this.newDeclarations['line-break']) {
        // to allow breaks one long string of periods
        return {
          key: 'line-break',
          value: 'loose'
        };
      }
    }
    return undefined;
  }
}

function getGeckoBrSolutionRule(): Rule {
  // <br> + display: block makes it line-height: 0 on Firefox, when it creates space on Chrome (regardless of display value)
  return {
    type: 'rule',
    selectors: ['br'],
    declarations: [
      {
        type: 'declaration',
        property: 'display',
        value: 'inline!important'
      }
    ]
  };
}
