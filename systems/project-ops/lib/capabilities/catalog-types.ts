export interface CapabilitySourceFile { path: string; sha256: string }
export interface CapabilityReferenceTest extends CapabilitySourceFile { line: number; symbol: string }
export interface CapabilityEntry extends CapabilityReferenceTest {
  system: string;
  kind: string;
  method: string;
  route: string;
  sourceCalls: string[];
  domain: string;
  label: string;
  decision: string;
  rationale: string;
  primarySources: string[];
  relatedTests: string[];
  runtimeStatus: string;
  testStatus: string;
  referenceTests: CapabilityReferenceTest[];
  referenceTestStatus: string;
  owner: string;
}
export interface CapabilityCatalog {
  schemaVersion: number;
  sourceBase: string;
  sourceDigest: string;
  sourceFilesDigest: string;
  sourceFiles: CapabilitySourceFile[];
  dataKind: string;
  scope: string;
  verification: string;
  entries: CapabilityEntry[];
}
