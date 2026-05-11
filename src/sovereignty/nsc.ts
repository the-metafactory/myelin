import type { Classification } from "../types";
import type { ScopeMapping, SovereigntyPolicy } from "./types";

/**
 * NSC command generation for sovereignty federation setup (T-9.1).
 *
 * Pure string emission — no subprocess execution. Operators pipe the
 * output into a shell or paste into their NSC workflow. Both helpers
 * are deterministic in their input and idempotent on the operator side:
 * each `add` is preceded by a tolerant `delete` so re-running the
 * script always lands the same end state.
 *
 * Account names and partner account public keys are emitted as shell
 * variable placeholders (`${ACCOUNT}`, `${PARTNER_ACCOUNT_<ORG>}`) so
 * a single generated script can be parameterised at runtime.
 *
 * Subjects are emitted single-quoted. Defense-in-depth: NATS subject
 * grammar excludes shell metacharacters, but a compromised policy KV
 * in a federation context could smuggle `$()` or backtick sequences
 * through a `--subject` argument; single quotes suppress all bash
 * expansion so the command stays literal regardless of policy origin.
 */

export interface NscCommandOptions {
  /**
   * Local NSC account name. Defaults to the `${ACCOUNT}` shell
   * placeholder so the generated script can be parameterised
   * (`ACCOUNT=myelin bash federation.sh`).
   */
  account?: string;

  /**
   * NATS account export kind. Envelope traffic is fundamentally
   * pub/sub messaging, so `stream` is the default and correct choice
   * for myelin federation. `service` exists for traditional NSC
   * request/reply semantics if a deployment needs it.
   */
  exportKind?: "stream" | "service";
}

const ACCOUNT_PLACEHOLDER = "${ACCOUNT}";
const DEFAULT_EXPORT_KIND: "stream" | "service" = "stream";

const EXPORTABLE_CLASSIFICATIONS = new Set<Classification>(["federated", "public"]);

function slugifySubject(subject: string): string {
  return subject
    .replace(/\./g, "-")
    .replace(/>/g, "all")
    .replace(/\*/g, "any")
    .replace(/[^a-zA-Z0-9-]/g, "");
}

function exportName(subject: string): string {
  return `myelin-export-${slugifySubject(subject)}`;
}

function importName(partnerOrg: string, subject: string): string {
  return `myelin-import-${partnerOrg}-${slugifySubject(subject)}`;
}

function partnerAccountPlaceholder(partnerOrg: string): string {
  const upper = partnerOrg.toUpperCase().replace(/[^A-Z0-9]/g, "_");
  return `\${PARTNER_ACCOUNT_${upper}}`;
}

/**
 * Generate `nsc add export` commands for every subject in the
 * policy's `egress.rules` whose classification is `federated` or
 * `public`. `local`-classified subjects are intentionally excluded —
 * by definition they must not cross the account boundary.
 *
 * Subjects that appear in more than one rule are exported once.
 *
 * Each subject yields two lines:
 *   1. `nsc delete export ... 2>/dev/null || true` (idempotency)
 *   2. `nsc add export ... --stream` (or `--service` if requested)
 */
export function generateExportCommands(
  policy: SovereigntyPolicy,
  options: NscCommandOptions = {},
): string[] {
  const account = options.account ?? ACCOUNT_PLACEHOLDER;
  const kind = options.exportKind ?? DEFAULT_EXPORT_KIND;
  const kindFlag = kind === "service" ? "--service" : "--stream";

  const out: string[] = [];
  out.push(`# myelin sovereignty exports for org: ${policy.org}`);
  out.push(`# Generated from SovereigntyPolicy. Re-run safely: existing exports`);
  out.push(`# are deleted before being re-added.`);
  out.push(`# Set ACCOUNT in the shell environment, or replace ${ACCOUNT_PLACEHOLDER}.`);

  const seen = new Set<string>();
  for (const rule of policy.egress.rules) {
    if (!EXPORTABLE_CLASSIFICATIONS.has(rule.classification)) continue;
    for (const subject of rule.allowed_subjects) {
      if (seen.has(subject)) continue;
      seen.add(subject);
      const name = exportName(subject);
      out.push(
        `nsc delete export --account ${account} --subject '${subject}' 2>/dev/null || true`,
      );
      out.push(
        `nsc add export --account ${account} --name ${name} --subject '${subject}' ${kindFlag}`,
      );
    }
  }
  return out;
}

/**
 * Generate `nsc add import` commands for a single federation
 * scope mapping. One import is emitted per subject in
 * `mapping.local_scope`. The partner's account public key is emitted
 * as a shell placeholder (`${PARTNER_ACCOUNT_<UPPER_ORG>}`) because
 * NSC requires the partner's signing key to bind the import.
 *
 * NSC imports are subject-level; principal-level enforcement
 * (matching against `imported_principals`) happens at ingress
 * validation, not at NSC. The principals are documented as a header
 * comment for the operator.
 */
export function generateImportCommands(
  mapping: ScopeMapping,
  options: NscCommandOptions = {},
): string[] {
  const account = options.account ?? ACCOUNT_PLACEHOLDER;
  const partnerAcct = partnerAccountPlaceholder(mapping.partner_org);

  const out: string[] = [];
  out.push(`# myelin sovereignty imports from partner: ${mapping.partner_org}`);
  out.push(`# Imported principals (enforced at ingress validation, not NSC):`);
  if (mapping.imported_principals.length === 0) {
    out.push(`#   (none configured)`);
  } else {
    for (const did of mapping.imported_principals) {
      out.push(`#   - ${did}`);
    }
  }
  out.push(`# Set ${partnerAcct} to the partner's NSC account public key.`);

  const seen = new Set<string>();
  for (const subject of mapping.local_scope) {
    if (seen.has(subject)) continue;
    seen.add(subject);
    const name = importName(mapping.partner_org, subject);
    out.push(
      `nsc delete import --account ${account} --src-account ${partnerAcct} --subject '${subject}' 2>/dev/null || true`,
    );
    out.push(
      `nsc add import --account ${account} --src-account ${partnerAcct} --name ${name} --subject '${subject}'`,
    );
  }
  return out;
}

/**
 * Convenience: generate the complete federation script for a policy —
 * exports plus imports for every scope mapping, in a single ordered
 * list. Operators typically pipe this into a shell script.
 */
export function generateFederationScript(
  policy: SovereigntyPolicy,
  options: NscCommandOptions = {},
): string[] {
  const out: string[] = [];
  out.push(...generateExportCommands(policy, options));
  for (const mapping of policy.ingress.scope_mappings) {
    out.push("");
    out.push(...generateImportCommands(mapping, options));
  }
  return out;
}
