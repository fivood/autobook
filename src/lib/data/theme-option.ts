/**
 * @license BSD-3-Clause
 * Copyright (c) 2026, ッツ Reader Authors
 * All rights reserved.
 */

export interface ColorObject {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface ThemeOption {
  fontColor: string;
  backgroundColor: string;
  selectionFontColor: string;
  selectionBackgroundColor: string;
  menuBackgroundColor: string;
  menuFontColor: string;
  buttonSelectedColor: string;
  buttonHoverColor: string;
  linkColor: string;
  /** legacy — kept for compatibility with existing book renderer code, hidden from UI */
  hintFuriganaShadowColor: string;
  /** legacy — kept for compatibility */
  hintFuriganaFontColor: string;
  /** legacy — kept for compatibility */
  tooltipTextFontColor: string;
}

export interface CustomThemeValue {
  hexExpression: string;
  alphaValue: number;
  rgbaExpression: string;
}

function rgba(r: number, g: number, b: number, a?: number) {
  return { r, g, b, ...(a !== undefined ? { a } : {}) };
}

function fillTheme(t: Partial<Record<keyof ThemeOption, ColorObject>>): Record<keyof ThemeOption, ColorObject> {
  const fontColor = t.fontColor || rgba(0, 0, 0, 0.87);
  return {
    fontColor,
    backgroundColor: t.backgroundColor || rgba(255, 255, 255),
    selectionFontColor: t.selectionFontColor || rgba(255, 255, 255),
    selectionBackgroundColor: t.selectionBackgroundColor || rgba(95, 126, 123),
    menuBackgroundColor: t.menuBackgroundColor || rgba(43, 90, 105),
    menuFontColor: t.menuFontColor || rgba(240, 239, 230),
    buttonSelectedColor: t.buttonSelectedColor || rgba(95, 126, 123),
    buttonHoverColor: t.buttonHoverColor || rgba(95, 126, 123, 0.18),
    linkColor: t.linkColor || rgba(43, 90, 105),
    hintFuriganaFontColor: t.hintFuriganaFontColor || { ...fontColor, a: (fontColor.a ?? 1) * 0.38 },
    hintFuriganaShadowColor: t.hintFuriganaShadowColor || rgba(34, 34, 49, 0.3),
    tooltipTextFontColor: t.tooltipTextFontColor || rgba(64, 90, 92, 0.7)
  };
}

const lightTheme = fillTheme({
  fontColor: rgba(0, 0, 0, 0.87),
  backgroundColor: rgba(255, 255, 255),
  selectionFontColor: rgba(245, 245, 245),
  selectionBackgroundColor: rgba(151, 151, 151),
  menuBackgroundColor: rgba(55, 65, 81),
  menuFontColor: rgba(255, 255, 255),
  buttonSelectedColor: rgba(17, 24, 39),
  buttonHoverColor: rgba(0, 0, 0, 0.08),
  linkColor: rgba(30, 64, 175)
});

const darkTheme = fillTheme({
  fontColor: rgba(255, 255, 255, 0.87),
  backgroundColor: rgba(0x23, 0x27, 0x2a),
  selectionFontColor: rgba(85, 90, 92, 0.6),
  selectionBackgroundColor: rgba(212, 217, 220, 0.8),
  menuBackgroundColor: rgba(17, 24, 39),
  menuFontColor: rgba(240, 240, 241),
  buttonSelectedColor: rgba(75, 85, 99),
  buttonHoverColor: rgba(255, 255, 255, 0.12),
  linkColor: rgba(125, 211, 252)
});

const availableThemesCamelCase = {
  lightTheme,
  ecruTheme: fillTheme({
    ...lightTheme,
    backgroundColor: rgba(0xf7, 0xf6, 0xeb)
  }),
  waterTheme: fillTheme({
    ...lightTheme,
    backgroundColor: rgba(0xdf, 0xec, 0xf4),
    linkColor: rgba(14, 116, 144)
  }),
  /** Called gray theme for legacy reasons */
  grayTheme: darkTheme,
  /** Called dark theme for legacy reasons */
  darkTheme: fillTheme({
    ...darkTheme,
    fontColor: rgba(255, 255, 255, 0.6),
    backgroundColor: rgba(0x12, 0x12, 0x12)
  }),
  blackTheme: fillTheme({
    ...darkTheme,
    backgroundColor: rgba(0, 0, 0)
  }),
  sageGreenTheme: fillTheme({
    fontColor: rgba(0x40, 0x5a, 0x5c, 0.92),
    backgroundColor: rgba(0xf0, 0xef, 0xe6),
    selectionFontColor: rgba(0xf0, 0xef, 0xe6),
    selectionBackgroundColor: rgba(0x5f, 0x7e, 0x7b),
    menuBackgroundColor: rgba(0x2b, 0x5a, 0x69),
    menuFontColor: rgba(0xf0, 0xef, 0xe6),
    buttonSelectedColor: rgba(0x2b, 0x5a, 0x69),
    buttonHoverColor: rgba(0x5f, 0x7e, 0x7b, 0.18),
    linkColor: rgba(0x2b, 0x5a, 0x69)
  })
};

function themeObjValueToStringValue<T extends string>(objValue: Record<T, ColorObject>) {
  return Object.entries(objValue).reduce<Record<T, string>>((acc, [key, value]) => {
    const obj = value as ColorObject;
    acc[key as T] = `rgba(${obj.r}, ${obj.g}, ${obj.b}, ${obj.a ?? 1})`;
    return acc;
  }, {} as any);
}

function camelCaseToKebabCase(s: string) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export const availableThemes = new Map(
  Object.entries(availableThemesCamelCase).map(([key, value]) => [
    camelCaseToKebabCase(key),
    themeObjValueToStringValue(value)
  ])
);
