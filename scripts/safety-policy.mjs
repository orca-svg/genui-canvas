const DANGEROUS_RUNTIME_PATTERNS = [
  [/dangerouslySetInnerHTML/, "React raw HTML injection is forbidden"],
  [/\beval\s*\(/, "eval is forbidden"],
  [/\bnew\s+Function\s*\(/, "dynamic Function construction is forbidden"],
];

const BROWSER_STORAGE_PATTERNS = [
  [/\blocalStorage\b/, "persistent browser storage is outside the privacy contract"],
  [/\bsessionStorage\b/, "sessionStorage is outside the privacy contract"],
  [/document\.cookie/, "browser cookies are outside the privacy contract"],
];

const DEFINITIVE_ELIGIBILITY = ["받을 수 있습니다", "자격이 됩니다", "수급 자격"];

export function checkCredentialText(file, text) {
  const issues = [];
  const patterns = [
    /AIza[0-9A-Za-z_-]{20,}/,
    /sk-ant-[0-9A-Za-z_-]{20,}/,
    /ghp_[0-9A-Za-z]{20,}/,
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  ];
  if (patterns.some((pattern) => pattern.test(text))) {
    issues.push(`${file}: value resembles a committed credential or private key`);
  }
  return issues;
}

export function checkSourceText(file, text) {
  const issues = [];
  const isTest = /(?:^|\/)\w[^/]*\.test\.[cm]?[jt]sx?$/.test(file);
  const addMatches = (rules) => {
    for (const [pattern, message] of rules) {
      if (pattern.test(text)) issues.push(`${file}: ${message}`);
    }
  };

  addMatches(DANGEROUS_RUNTIME_PATTERNS);
  if (file.startsWith("apps/web/src/") && !isTest) addMatches(BROWSER_STORAGE_PATTERNS);

  if (!isTest) {
    for (const phrase of DEFINITIVE_ELIGIBILITY) {
      if (text.includes(phrase)) {
        issues.push(`${file}: definitive eligibility phrase is forbidden: ${phrase}`);
      }
    }
  }

  if (file === "apps/server/src/llm/prompts.ts") {
    const rawPromptChannels = [
      /context\.trigger\.text/,
      /JSON\.stringify\(context\.profile\)/,
      /\bc\.title\b/,
      /\bresource\.title\b/,
      /\be\.title\b/,
    ];
    for (const pattern of rawPromptChannels) {
      if (pattern.test(text)) {
        issues.push(`${file}: raw user/gateway display text entered the model prompt`);
      }
    }
  }

  for (const anchor of text.matchAll(/<a\b[\s\S]*?<\/a>/g)) {
    const markup = anchor[0];
    if (/target=["']_blank["']/.test(markup) && !/rel=["']noopener noreferrer["']/.test(markup)) {
      issues.push(`${file}: target=_blank link must set rel="noopener noreferrer"`);
    }
  }

  issues.push(...checkCredentialText(file, text));

  return issues;
}
