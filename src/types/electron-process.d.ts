// @ts-check
/**
 * Electron adds `process.resourcesPath`, and `@types/node` does not declare it.
 * The plugin reads it to find the Harness the Desktop app actually runs
 * (`<resources>/app.asar/dsh`); outside Electron it is simply absent, which is
 * why it is optional here and every reader has to tolerate `undefined`.
 */
declare namespace NodeJS {
  interface Process {
    readonly resourcesPath?: string
  }
}
