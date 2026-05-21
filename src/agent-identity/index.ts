export type {
  AgentIdentity,
  AgentIdentityFile,
  AgentIdentityFileV1,
  AgentIdentityFileV2,
  AgentIdentityWithoutPrivateKey,
} from "./types";
export { generateAgentIdentity, type GenerateAgentIdentityInput } from "./generate";
export {
  rotateAgentIdentity,
  type RotateAgentIdentityInput,
  type RotateAgentIdentityResult,
} from "./rotate";
export {
  saveAgentIdentity,
  loadAgentIdentity,
  type SaveAgentIdentityOptions,
  type LoadAgentIdentityOptions,
} from "./store";
export {
  encryptPrivateKey,
  decryptPrivateKey,
  isEncryptedPrivateKey,
  MIN_LOAD_ITERATIONS,
  type EncryptedPrivateKey,
} from "./encryption";
export {
  toSigningIdentity,
  toIdentity,
  registerSelf,
  type RegisterSelfOptions,
} from "./helpers";
// `toPrincipal` is a deprecated alias of `toIdentity` (R1, vocabulary
// migration 2026-05) — re-exported so submodule-path callers keep
// compiling through the deprecation window. The eslint-disable below
// silences the no-deprecated rule on the alias re-export — that
// re-export IS the back-compat hook.
/* eslint-disable @typescript-eslint/no-deprecated */
export { toPrincipal } from "./helpers";
/* eslint-enable @typescript-eslint/no-deprecated */
