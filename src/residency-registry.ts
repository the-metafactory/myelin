/**
 * Closed value registry for `sovereignty.data_residency` (RFC-0005 §2.3).
 *
 * The wire *grammar* (`^[A-Z]{2}$`) admits any two uppercase letters as a
 * shape; the *value* registry is CLOSED (grill D5, closes OD-4): a conformant
 * validator accepts only ISO 3166-1 alpha-2 **assigned** codes plus the
 * regional convention `EU`. An unassigned or user-assigned code (e.g. `ZZ`,
 * `XX`, `QM`–`QZ`, `XA`–`XZ`) is rejected at envelope validation — fail-closed.
 *
 * This closes the §5.4 evasion vector where a sender dodges residency gating by
 * declaring a code the principal never enumerated: with the registry open, an
 * unlisted code fell through the egress `data_residency_constraints` lookup to
 * ALLOW (`sovereignty/validators/egress.ts`). Fail-open there stays conformant
 * ONLY because the code can no longer reach egress — it is rejected upstream at
 * envelope validation.
 *
 * Leaf module, no imports — same containment pattern as `./classifications`, so
 * the envelope schema can pull the registry in without dragging dependencies.
 * Extending the registry (a new regional convention) is a wire change per
 * BCP-0001.
 */

/**
 * The 249 officially assigned ISO 3166-1 alpha-2 country codes plus the `EU`
 * regional convention. Source of truth is the single array below; the set and
 * guard are derived from it.
 */
export const RESIDENCY_CODES = [
  // Regional convention (RFC-0005 §2.3) — not an ISO country code.
  'EU',
  // ISO 3166-1 alpha-2 officially assigned codes.
  'AD', 'AE', 'AF', 'AG', 'AI', 'AL', 'AM', 'AO', 'AQ', 'AR', 'AS', 'AT', 'AU', 'AW', 'AX', 'AZ',
  'BA', 'BB', 'BD', 'BE', 'BF', 'BG', 'BH', 'BI', 'BJ', 'BL', 'BM', 'BN', 'BO', 'BQ', 'BR', 'BS',
  'BT', 'BV', 'BW', 'BY', 'BZ',
  'CA', 'CC', 'CD', 'CF', 'CG', 'CH', 'CI', 'CK', 'CL', 'CM', 'CN', 'CO', 'CR', 'CU', 'CV', 'CW',
  'CX', 'CY', 'CZ',
  'DE', 'DJ', 'DK', 'DM', 'DO', 'DZ',
  'EC', 'EE', 'EG', 'EH', 'ER', 'ES', 'ET',
  'FI', 'FJ', 'FK', 'FM', 'FO', 'FR',
  'GA', 'GB', 'GD', 'GE', 'GF', 'GG', 'GH', 'GI', 'GL', 'GM', 'GN', 'GP', 'GQ', 'GR', 'GS', 'GT',
  'GU', 'GW', 'GY',
  'HK', 'HM', 'HN', 'HR', 'HT', 'HU',
  'ID', 'IE', 'IL', 'IM', 'IN', 'IO', 'IQ', 'IR', 'IS', 'IT',
  'JE', 'JM', 'JO', 'JP',
  'KE', 'KG', 'KH', 'KI', 'KM', 'KN', 'KP', 'KR', 'KW', 'KY', 'KZ',
  'LA', 'LB', 'LC', 'LI', 'LK', 'LR', 'LS', 'LT', 'LU', 'LV', 'LY',
  'MA', 'MC', 'MD', 'ME', 'MF', 'MG', 'MH', 'MK', 'ML', 'MM', 'MN', 'MO', 'MP', 'MQ', 'MR', 'MS',
  'MT', 'MU', 'MV', 'MW', 'MX', 'MY', 'MZ',
  'NA', 'NC', 'NE', 'NF', 'NG', 'NI', 'NL', 'NO', 'NP', 'NR', 'NU', 'NZ',
  'OM',
  'PA', 'PE', 'PF', 'PG', 'PH', 'PK', 'PL', 'PM', 'PN', 'PR', 'PS', 'PT', 'PW', 'PY',
  'QA',
  'RE', 'RO', 'RS', 'RU', 'RW',
  'SA', 'SB', 'SC', 'SD', 'SE', 'SG', 'SH', 'SI', 'SJ', 'SK', 'SL', 'SM', 'SN', 'SO', 'SR', 'SS',
  'ST', 'SV', 'SX', 'SY', 'SZ',
  'TC', 'TD', 'TF', 'TG', 'TH', 'TJ', 'TK', 'TL', 'TM', 'TN', 'TO', 'TR', 'TT', 'TV', 'TW', 'TZ',
  'UA', 'UG', 'UM', 'US', 'UY', 'UZ',
  'VA', 'VC', 'VE', 'VG', 'VI', 'VN', 'VU',
  'WF', 'WS',
  'YE', 'YT',
  'ZA', 'ZM', 'ZW',
] as const;

const RESIDENCY_SET: ReadonlySet<string> = new Set(RESIDENCY_CODES);

/**
 * True iff `code` is an assigned ISO 3166-1 alpha-2 code or the `EU`
 * convention. Assumes `code` already matched the `^[A-Z]{2}$` shape — this is
 * the value-registry gate that runs *after* the format check.
 */
export function isAssignedResidency(code: string): boolean {
  return RESIDENCY_SET.has(code);
}
