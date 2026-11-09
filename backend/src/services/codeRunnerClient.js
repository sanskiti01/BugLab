const RESPONSE_LIMIT_BYTES = 16 * 1024;
const REQUEST_TIMEOUT_MS = 5000;

class CodeRunnerUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodeRunnerUnavailableError";
  }
}

const getRunnerConfig = () => {
  const runnerUrl = process.env.CODE_RUNNER_URL;
  const runnerToken = process.env.CODE_RUNNER_TOKEN;

  if (!runnerUrl || !runnerToken) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner is not configured"
    );
  }

  let url;
  try {
    url = new URL(runnerUrl);
  } catch {
    throw new CodeRunnerUnavailableError("The isolated code runner URL is invalid");
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";

  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password
  ) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner must use HTTPS"
    );
  }

  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/execute`;
  url.search = "";
  url.hash = "";

  return { url, runnerToken };
};

const readBoundedJson = async (response) => {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > RESPONSE_LIMIT_BYTES) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner response exceeded its size limit"
    );
  }

  if (!response.body) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner returned an invalid response"
    );
  }

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    totalBytes += value.byteLength;
    if (totalBytes > RESPONSE_LIMIT_BYTES) {
      await reader.cancel();
      throw new CodeRunnerUnavailableError(
        "The isolated code runner response exceeded its size limit"
      );
    }

    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner returned an invalid response"
    );
  }
};

const executeTestCase = async ({ code, input, timeoutMs }) => {
  const { url, runnerToken } = getRunnerConfig();

  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${runnerToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        language: "javascript",
        code,
        input,
        timeoutMs,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner is unavailable"
    );
  }

  if (!response.ok) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner rejected the request"
    );
  }

  let result;
  try {
    result = await readBoundedJson(response);
  } catch (error) {
    if (error instanceof CodeRunnerUnavailableError) throw error;
    throw new CodeRunnerUnavailableError(
      "The isolated code runner returned an invalid response"
    );
  }
  if (
    !result ||
    typeof result !== "object" ||
    typeof result.timedOut !== "boolean" ||
    (result.output !== undefined && typeof result.output !== "string") ||
    (result.error !== undefined &&
      result.error !== null &&
      typeof result.error !== "string")
  ) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner returned an invalid response"
    );
  }

  if (result.output?.length > 8192 || result.error?.length > 1024) {
    throw new CodeRunnerUnavailableError(
      "The isolated code runner response exceeded its field limits"
    );
  }

  return {
    output: result.output || "",
    timedOut: result.timedOut,
    error: result.error || null,
  };
};

module.exports = {
  CodeRunnerUnavailableError,
  executeTestCase,
};
