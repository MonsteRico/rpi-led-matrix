import globby from 'globby';
import ora from 'ora';
import { basename } from 'path';
import prompts from 'prompts';
import {
  Font,
  HorizontalAlignment,
  LayoutUtils,
  LedMatrix,
  VerticalAlignment,
  type Color,
  type FontInstance,
} from '../src';
import { matrixOptions, runtimeOptions } from './_config';

const Colors = {
  Aquamarine: 0x7fffd4,
  Black: 0x000000,
  Blue: 0x0000ff,
  Cyan: 0x00ffff,
  Green: 0x00ff00,
  Magenta: 0xff00ff,
  Purple: 0x800080,
  Red: 0xff0000,
  White: 0xffffff,
  Yellow: 0xffff00,
};

const wait = (t: number) => new Promise(ok => setTimeout(ok, t));

enum CliMode {
  BgColor = 'bgColor',
  Brightness = 'brightness',
  Exit = 'exit',
  FgColor = 'fgColor',
  Font = 'font',
  HorizontalAlignment = 'horizontalAlignment',
  Text = 'text',
  VerticalAlignment = 'verticalAlignment',
}

type FontMap = Record<string, FontInstance>;

const prependChoiceToGoBack = (choices: prompts.Choice[]) => [
  { title: '⬅️  Go back', value: '' },
  ...choices,
];

const createBrightnessPrompter =
  () =>
  (currentBrightness = 100): Promise<{ brightness: number }> =>
    prompts({
      name: 'brightness',
      type: 'number',
      max: 100,
      min: 0,
      message: `Enter a brightness value or press escape to go back (current brightness is ${currentBrightness}%)`,
    });

const createColorSelector = (
  colorType: string,
  colors: Record<string, number>
) => {
  const colorIndex: Record<number, string> = Object.entries(colors).reduce(
    (index, [name, value]) => ({ ...index, [value]: name }),
    {}
  );
  const findColorName = ({ r, g, b }: Color) =>
    colorIndex[((r << 16) | (g << 8) | b) & 0xffffff];

  return (currentColor: Color): Promise<{ color: string }> => {
    const currentColorName = findColorName(currentColor);
    const currentColorIndex =
      Object.keys(colors).indexOf(currentColorName) || 0;

    return prompts({
      name: 'color',
      type: 'select',
      hint: !currentColorName
        ? ''
        : `Current ${colorType} color is ${currentColorName.toLowerCase()}`,
      initial: currentColorIndex + 1,
      message: `Select a ${colorType} color`,
      choices: prependChoiceToGoBack(
        Object.entries(colors).map(([title, value]) => ({
          title,
          value: `${value}`,
        }))
      ),
    });
  };
};

const createFontSelector =
  (fontList: FontInstance[]) =>
  (currentFont = ''): Promise<{ font: string }> => {
    const currentFontIndex =
      fontList.map(f => f.name()).indexOf(currentFont) || 0;

    return prompts({
      name: 'font',
      type: 'select',
      message: `Select a font`,
      initial: currentFontIndex + 1,
      hint: !currentFont ? '' : `Current font is "${currentFont}"`,
      choices: prependChoiceToGoBack(
        fontList.map(font => ({
          title: `${font.name()}\t(height ${font.height()}px)`,
          value: font.name(),
        }))
      ),
    });
  };

function createAlignmentSelector<T extends string>(
  alignmentType: string,
  alignments: T[]
) {
  return (currentAlignment: T): Promise<{ alignment: T }> => {
    const currentIndex =
      Object.values(alignments).indexOf(currentAlignment) || 0;

    return prompts({
      name: 'alignment',
      type: 'select',
      message: `Set the ${alignmentType} alignment`,
      initial: currentIndex + 1,
      hint: !currentAlignment
        ? ''
        : `Current alignment is "${currentAlignment as unknown as string}"`,
      choices: prependChoiceToGoBack(
        Object.entries(alignments).map(([k, v]) => ({
          title: k,
          value: v,
        }))
      ),
    });
  };
}

const createTextPrompter = () => (): Promise<{ text: string }> =>
  prompts({
    name: 'text',
    type: 'text',
    message: 'Input text to display or press escape to go back',
  });

const createModeSelector = () => (): Promise<{ mode: CliMode }> =>
  prompts({
    name: 'mode',
    type: 'select',
    message: 'What would you like to do?',
    hint: 'Use tab or arrow keys and press enter to select.',
    choices: [
      { value: CliMode.Text, title: '🔠 Render some text' },
      { value: CliMode.Font, title: '✒️  Change the font' },
      { value: CliMode.BgColor, title: '🎨 Pick a background color' },
      { value: CliMode.FgColor, title: '🎨 Pick a foreground color' },
      {
        value: CliMode.HorizontalAlignment,
        title: '↔️  Set the horizontal alignment',
      },
      {
        value: CliMode.VerticalAlignment,
        title: '↕️  Set the vertical alignment',
      },
      { value: CliMode.Brightness, title: '🌟 Set the display brightness' },
      { value: CliMode.Exit, title: '🚪 Exit' },
    ],
  });

(async () => {
  try {
    const matrix = new LedMatrix(matrixOptions, runtimeOptions).afterSync(
      () => undefined
    );

    const fontLoader = ora({ color: 'magenta' })
      .start('Loading fonts')
      .stopAndPersist();
    const fontExt = '.bdf';
    const fontList = (await globby(`${process.cwd()}/fonts/*${fontExt}`))
      .filter(path => !Number.isSafeInteger(+basename(path, fontExt)[0]))
      .map(path => {
        const name = basename(path, fontExt);
        fontLoader.start(`"${name}"`);
        const font = new Font(basename(path, fontExt), path);
        fontLoader.succeed();

        return font;
      });
    if (fontList.length < 1) {
      throw new Error(`No fonts were loaded!`);
    } else {
      // Set some default values
      matrix.clear().font(fontList[18]).fgColor(Colors.Magenta).sync();
    }

    const fonts: FontMap = fontList.reduce(
      (map, font) => ({ ...map, [font.name()]: font }),
      {}
    );

    const chooseBgColor = createColorSelector('background', Colors);
    const chooseFgColor = createColorSelector('foreground', Colors);
    const chooseHorizontalAlignment = createAlignmentSelector(
      'horizontal',
      Object.values(HorizontalAlignment)
    );
    const chooseVerticalAlignment = createAlignmentSelector(
      'vertical',
      Object.values(VerticalAlignment)
    );
    const chooseMode = createModeSelector();
    const chooseFont = createFontSelector(fontList);
    const inputText = createTextPrompter();
    const setBrightness = createBrightnessPrompter();

    // Maintain the alignment state
    let alignmentH: HorizontalAlignment = HorizontalAlignment.Center;
    let alignmentV: VerticalAlignment = VerticalAlignment.Middle;

    // Maintain a thunk of the latest render operation so that it can be repeated when options change
    // eslint-disable-next-line
    let render: () => any = () => {
      matrix.clear();
      const fgColor = matrix.fgColor();
      matrix.fgColor(matrix.bgColor()).fill().fgColor(fgColor);
      const font = fonts[matrix.font()];
      const lines = LayoutUtils.textToLines(
        font,
        matrix.width(),
        'Hello, matrix!'
      );

      LayoutUtils.linesToMappedGlyphs(
        lines,
        font.height(),
        matrix.width(),
        matrix.height(),
        alignmentH,
        alignmentV
      ).map(glyph => {
        matrix.drawText(glyph.char, glyph.x, glyph.y);
      });
      matrix.sync();
    };

    // Render the hello message
    render();

    while (true) {
      switch ((await chooseMode()).mode) {
        case CliMode.BgColor: {
          while (true) {
            const { color } = await chooseBgColor(matrix.bgColor());
            if (color && Number.isSafeInteger(+color)) {
              matrix.bgColor(+color);
              render();
            } else break;
          }
          break;
        }
        case CliMode.FgColor: {
          while (true) {
            const { color } = await chooseFgColor(matrix.fgColor());
            if (color && Number.isSafeInteger(+color)) {
              matrix.fgColor(+color);
              render();
            } else break;
          }
          break;
        }
        case CliMode.Font: {
          while (true) {
            const { font } = await chooseFont(matrix.font());
            if (font in fonts) {
              matrix.font(fonts[font]);
              render();
            } else break;
          }
          break;
        }
        case CliMode.Brightness: {
          while (true) {
            const { brightness } = await setBrightness(matrix.brightness());
            if (Number.isSafeInteger(brightness)) {
              matrix.brightness(brightness);
              render();
            } else break;
          }
          break;
        }
        case CliMode.HorizontalAlignment: {
          while (true) {
            const { alignment } = (await chooseHorizontalAlignment(
              alignmentH
            )) as { alignment: HorizontalAlignment };
            if (alignment) {
              alignmentH = alignment;
              render();
            } else break;
          }
          break;
        }
        case CliMode.VerticalAlignment: {
          while (true) {
            const { alignment } = (await chooseVerticalAlignment(
              alignmentV
            )) as { alignment: VerticalAlignment };
            if (alignment) {
              alignmentV = alignment;
              render();
            } else break;
          }
          break;
        }
        case CliMode.Text: {
          // Stay in text mode until escaped
          while (true) {
            const { text } = await inputText();
            // Go back to mode select if escape was pressed (text will be undefined)
            if (typeof text !== 'string') break;
            // Otherwise, show'em some text and thunk the operation
            render = async () => {
              matrix.clear();
              const fgColor = matrix.fgColor();
              matrix.fgColor(matrix.bgColor()).fill().fgColor(fgColor);
              const font = fonts[matrix.font()];
              const lines = LayoutUtils.textToLines(font, matrix.width(), text);

              const glyphs = LayoutUtils.linesToMappedGlyphs(
                lines,
                font.height(),
                matrix.width(),
                matrix.height(),
                alignmentH,
                alignmentV
              );

              for (const glyph of glyphs) {
                matrix.drawText(glyph.char, glyph.x, glyph.y);
                matrix.sync();
                await wait(150 * Math.random() + 20);
              }
            };

            render();
          }
          break;
        }
        case CliMode.Exit: {
          console.log('Bye!');
          process.exit(0);
        }
      }
    }
  } catch (error) {
    console.error(`${__filename} caught: `, error);
  }
})();
