/**
 * blendx/examples: run the app's review/*.examples.yaml from its own tests. A subpath of its
 * own, so the app's runtime import of blendx never loads the CLI.
 */
export { checkExamples, type ExamplesResult } from '@blendx/cli/examples';
