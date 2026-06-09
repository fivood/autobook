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
  selectionFontColor: rgba(255, 255, 255),
  selectionBackgroundColor: rgba(59, 130, 246),
  menuBackgroundColor: rgba(30, 41, 59),
  menuFontColor: rgba(248, 250, 252),
  buttonSelectedColor: rgba(59, 130, 246),
  buttonHoverColor: rgba(59, 130, 246, 0.15),
  linkColor: rgba(30, 64, 175)
});

const darkThemeBase = fillTheme({
  fontColor: rgba(255, 255, 255, 0.87),
  backgroundColor: rgba(0x23, 0x27, 0x2a),
  selectionFontColor: rgba(31, 41, 55),
  selectionBackgroundColor: rgba(156, 163, 175),
  menuBackgroundColor: rgba(55, 65, 81),
  menuFontColor: rgba(243, 244, 246),
  buttonSelectedColor: rgba(156, 163, 175),
  buttonHoverColor: rgba(255, 255, 255, 0.1),
  linkColor: rgba(125, 211, 252)
});

const seafoamTheme = fillTheme({
  fontColor: rgba(0x2a, 0x45, 0x45, 0.92),
  backgroundColor: rgba(0xe5, 0xed, 0xef),
  selectionFontColor: rgba(0xff, 0xff, 0xff),
  selectionBackgroundColor: rgba(0x5a, 0x90, 0x8a),
  menuBackgroundColor: rgba(0x3a, 0x6b, 0x65),
  menuFontColor: rgba(0xf0, 0xf5, 0xf5),
  buttonSelectedColor: rgba(0x5a, 0x90, 0x8a),
  buttonHoverColor: rgba(0x5a, 0x90, 0x8a, 0.18),
  linkColor: rgba(0x4a, 0x7a, 0x74)
});

const columbiaTheme = fillTheme({
  fontColor: rgba(0x1a, 0x33, 0x4a, 0.92),
  backgroundColor: rgba(0xcd, 0xd7, 0xdf),
  selectionFontColor: rgba(0xff, 0xff, 0xff),
  selectionBackgroundColor: rgba(0x3e, 0x69, 0x85),
  menuBackgroundColor: rgba(0x2b, 0x50, 0x6e),
  menuFontColor: rgba(0xe8, 0xed, 0xf1),
  buttonSelectedColor: rgba(0x3e, 0x69, 0x85),
  buttonHoverColor: rgba(0x3e, 0x69, 0x85, 0.18),
  linkColor: rgba(0x1c, 0x50, 0x70)
});

const doveTheme = fillTheme({
  fontColor: rgba(0x2c, 0x2a, 0x28, 0.92),
  backgroundColor: rgba(0xd3, 0xda, 0xde),
  selectionFontColor: rgba(0xff, 0xff, 0xff),
  selectionBackgroundColor: rgba(0x64, 0x61, 0x5c),
  menuBackgroundColor: rgba(0x4c, 0x49, 0x45),
  menuFontColor: rgba(0xf0, 0xf1, 0xf2),
  buttonSelectedColor: rgba(0x64, 0x61, 0x5c),
  buttonHoverColor: rgba(0x64, 0x61, 0x5c, 0.18),
  linkColor: rgba(0x3d, 0x3a, 0x36)
});

const abyssTheme = fillTheme({
  fontColor: rgba(0xb0, 0xc0, 0xc8, 0.92),
  backgroundColor: rgba(0x15, 0x25, 0x2d),
  selectionFontColor: rgba(0xe0, 0xe8, 0xec),
  selectionBackgroundColor: rgba(0x45, 0x59, 0x5c),
  menuBackgroundColor: rgba(0x29, 0x3a, 0x3e),
  menuFontColor: rgba(0xd0, 0xdc, 0xde),
  buttonSelectedColor: rgba(0x45, 0x59, 0x5c),
  buttonHoverColor: rgba(0x45, 0x59, 0x5c, 0.3),
  linkColor: rgba(0x80, 0xa0, 0xa8)
});

const espressoTheme = fillTheme({
  fontColor: rgba(0xd0, 0xc4, 0xba, 0.92),
  backgroundColor: rgba(0x21, 0x18, 0x15),
  selectionFontColor: rgba(0xf5, 0xf0, 0xeb),
  selectionBackgroundColor: rgba(0x6a, 0x5f, 0x53),
  menuBackgroundColor: rgba(0x48, 0x3f, 0x39),
  menuFontColor: rgba(0xf0, 0xec, 0xe6),
  buttonSelectedColor: rgba(0x6a, 0x5f, 0x53),
  buttonHoverColor: rgba(0x6a, 0x5f, 0x53, 0.3),
  linkColor: rgba(0xbc, 0xa5, 0x74)
});

const rainforestTheme = fillTheme({
  fontColor: rgba(0xc0, 0xd0, 0xc8, 0.92),
  backgroundColor: rgba(0x2b, 0x3f, 0x32),
  selectionFontColor: rgba(0xf0, 0xf5, 0xf0),
  selectionBackgroundColor: rgba(0x53, 0x65, 0x2d),
  menuBackgroundColor: rgba(0x45, 0x57, 0x66),
  menuFontColor: rgba(0xdc, 0xec, 0xee),
  buttonSelectedColor: rgba(0x53, 0x65, 0x2d),
  buttonHoverColor: rgba(0x53, 0x65, 0x2d, 0.3),
  linkColor: rgba(0x78, 0x86, 0x6b)
});

const availableThemesCamelCase = {
  lightTheme,
  ecruTheme: fillTheme({
    fontColor: rgba(0, 0, 0, 0.87),
    backgroundColor: rgba(0xf7, 0xf6, 0xeb),
    selectionFontColor: rgba(255, 255, 255),
    selectionBackgroundColor: rgba(168, 162, 158),
    menuBackgroundColor: rgba(87, 83, 78),
    menuFontColor: rgba(250, 250, 249),
    buttonSelectedColor: rgba(168, 162, 158),
    buttonHoverColor: rgba(168, 162, 158, 0.2),
    linkColor: rgba(146, 64, 14)
  }),
  waterTheme: fillTheme({
    fontColor: rgba(0, 0, 0, 0.87),
    backgroundColor: rgba(0xdf, 0xec, 0xf4),
    selectionFontColor: rgba(255, 255, 255),
    selectionBackgroundColor: rgba(6, 182, 212),
    menuBackgroundColor: rgba(8, 51, 68),
    menuFontColor: rgba(236, 254, 255),
    buttonSelectedColor: rgba(6, 182, 212),
    buttonHoverColor: rgba(6, 182, 212, 0.15),
    linkColor: rgba(14, 116, 144)
  }),
  seafoamTheme,
  columbiaTheme,
  doveTheme,
  /** Called gray theme for legacy reasons */
  grayTheme: darkThemeBase,
  /** Called dark theme for legacy reasons */
  darkTheme: fillTheme({
    fontColor: rgba(255, 255, 255, 0.6),
    backgroundColor: rgba(0x12, 0x12, 0x12),
    selectionFontColor: rgba(255, 255, 255),
    selectionBackgroundColor: rgba(115, 115, 115),
    menuBackgroundColor: rgba(38, 38, 38),
    menuFontColor: rgba(245, 245, 245),
    buttonSelectedColor: rgba(115, 115, 115),
    buttonHoverColor: rgba(255, 255, 255, 0.1),
    linkColor: rgba(125, 211, 252)
  }),
  blackTheme: fillTheme({
    fontColor: rgba(255, 255, 255, 0.87),
    backgroundColor: rgba(0, 0, 0),
    selectionFontColor: rgba(255, 255, 255),
    selectionBackgroundColor: rgba(82, 82, 82),
    menuBackgroundColor: rgba(23, 23, 23),
    menuFontColor: rgba(250, 250, 250),
    buttonSelectedColor: rgba(82, 82, 82),
    buttonHoverColor: rgba(255, 255, 255, 0.1),
    linkColor: rgba(125, 211, 252)
  }),
  abyssTheme,
  espressoTheme,
  rainforestTheme,
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
