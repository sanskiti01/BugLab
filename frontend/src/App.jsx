import React, {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";

const API_BASE_URL = (
  import.meta.env.VITE_API_BASE_URL?.trim() || "http://localhost:5000/api"
).replace(/\/+$/, "");
const AuthContext = createContext(null);

async function apiRequest(path, { token, ...options } = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const error = new Error(
      data.message || "Something went wrong. Please try again."
    );
    error.status = response.status;
    throw error;
  }

  return data;
}

function readStoredSubmission(storageKey) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return saved;
  } catch {
    localStorage.removeItem(storageKey);
    return null;
  }
}

function storedSubmissionMatches(storageKey, submissionId) {
  return readStoredSubmission(storageKey)?.submissionId === submissionId;
}

function AuthProvider({ children }) {
  const [auth, setAuth] = useState(() => {
    const token = localStorage.getItem("buglab_token");
    const user = localStorage.getItem("buglab_user");

    try {
      return token && user ? { token, user: JSON.parse(user) } : null;
    } catch {
      localStorage.removeItem("buglab_token");
      localStorage.removeItem("buglab_user");
      return null;
    }
  });

  const login = useCallback((data) => {
    const nextAuth = { token: data.token, user: data.user };
    localStorage.setItem("buglab_token", nextAuth.token);
    localStorage.setItem("buglab_user", JSON.stringify(nextAuth.user));
    setAuth(nextAuth);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("buglab_token");
    localStorage.removeItem("buglab_user");
    setAuth(null);
  }, []);

  return (
    <AuthContext.Provider value={{ auth, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() {
  return useContext(AuthContext);
}

function ProtectedRoute({ children }) {
  const { auth } = useAuth();
  return auth ? children : <Navigate to="/login" replace />;
}

function AppShell({ children }) {
  const { auth, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to={auth ? "/challenges" : "/login"}>
          <span className="brand-mark">B</span>
          <span>buglab</span>
        </Link>
        {auth && (
          <nav className="topbar-nav" aria-label="Main navigation">
            <Link to="/challenges">Challenges</Link>
            <span className="user-label">{auth.user.username}</span>
            <button className="text-button" onClick={logout} type="button">
              Log out
            </button>
          </nav>
        )}
      </header>
      <main>{children}</main>
      <footer className="footer">
        <span>Learn by finding the bug, not just writing the code.</span>
        <span>BugLab · Debugging practice</span>
      </footer>
    </div>
  );
}

function AuthPage({ mode }) {
  const isRegister = mode === "register";
  const { auth, login } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (auth) navigate("/challenges", { replace: true });
  }, [auth, navigate]);

  const updateField = (event) => {
    setForm((current) => ({ ...current, [event.target.name]: event.target.value }));
  };

  const submit = async (event) => {
    event.preventDefault();
    setError("");

    if (!form.email.trim() || !form.password) {
      setError("Enter your email and password.");
      return;
    }
    if (isRegister && !form.username.trim()) {
      setError("Choose a username.");
      return;
    }
    if (isRegister && form.password.length < 8) {
      setError("Your password must be at least 8 characters.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = isRegister ? "/auth/register" : "/auth/login";
      const payload = isRegister
        ? { username: form.username.trim(), email: form.email.trim(), password: form.password }
        : { email: form.email.trim(), password: form.password };
      const result = await apiRequest(endpoint, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (isRegister) {
        navigate("/login", {
          replace: true,
          state: { message: "Account created. Log in to start debugging." },
        });
      } else {
        login(result);
        navigate("/challenges", { replace: true });
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppShell>
      <section className="auth-layout">
        <div className="auth-intro">
          <p className="eyebrow">REAL-WORLD DEBUGGING PRACTICE</p>
          <h1>Good engineers fix things they didn’t write.</h1>
          <p>
            Investigate broken software, follow the evidence, and build the
            debugging skills you’ll use on real teams.
          </p>
          <div className="intro-points">
            <span><b>01</b> Explore a bug report</span>
            <span><b>02</b> Trace the cause</span>
            <span><b>03</b> Learn from the fix</span>
          </div>
        </div>
        <form className="auth-card" onSubmit={submit} noValidate>
          <p className="eyebrow">{isRegister ? "GET STARTED" : "WELCOME BACK"}</p>
          <h2>{isRegister ? "Create your account" : "Sign in to BugLab"}</h2>
          {!isRegister && location.state?.message && (
            <p className="form-success" role="status">{location.state.message}</p>
          )}
          {isRegister && (
            <label>
              Username
              <input
                autoComplete="username"
                name="username"
                onChange={updateField}
                placeholder="How should we call you?"
                value={form.username}
              />
            </label>
          )}
          <label>
            Email
            <input
              autoComplete="email"
              name="email"
              onChange={updateField}
              placeholder="you@example.com"
              type="email"
              value={form.email}
            />
          </label>
          <label>
            Password
            <input
              autoComplete={isRegister ? "new-password" : "current-password"}
              name="password"
              onChange={updateField}
              placeholder="At least 8 characters"
              type="password"
              value={form.password}
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="primary-button full-width" disabled={loading} type="submit">
            {loading ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>
          <p className="auth-switch">
            {isRegister ? "Already have an account?" : "New to BugLab?"}{" "}
            <Link to={isRegister ? "/login" : "/register"}>
              {isRegister ? "Sign in" : "Create an account"}
            </Link>
          </p>
        </form>
      </section>
    </AppShell>
  );
}

function ChallengesPage() {
  const { auth, logout } = useAuth();
  const [bugs, setBugs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [difficulty, setDifficulty] = useState("ALL");

  useEffect(() => {
    let active = true;
    apiRequest("/bugs", { token: auth.token })
      .then((result) => {
        if (active) setBugs(result.bugs || []);
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.status === 401) {
          logout();
          return;
        }
        setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.token, logout]);

  const filteredBugs = bugs.filter((bug) => {
    const matchesQuery = `${bug.title} ${bug.description} ${bug.language} ${bug.topic}`
      .toLowerCase()
      .includes(query.toLowerCase());
    return matchesQuery && (difficulty === "ALL" || bug.difficulty === difficulty);
  });

  return (
    <AppShell>
      <section className="page-heading">
        <p className="eyebrow">THE DEBUGGING WORKBENCH</p>
        <div className="heading-row">
          <div>
            <h1>Find the fault. Fix the cause.</h1>
            <p>Choose a challenge and start investigating.</p>
          </div>
          <span className="challenge-count">{bugs.length} challenges</span>
        </div>
      </section>
      <section className="challenge-section">
        <div className="filters">
          <label className="search-field">
            <span className="visually-hidden">Search challenges</span>
            <span aria-hidden="true">⌕</span>
            <input
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search bugs, topics, languages…"
              value={query}
            />
          </label>
          <label className="filter-field">
            <span className="visually-hidden">Filter by difficulty</span>
            <select onChange={(event) => setDifficulty(event.target.value)} value={difficulty}>
              <option value="ALL">All difficulties</option>
              <option value="EASY">Easy</option>
              <option value="MEDIUM">Medium</option>
              <option value="HARD">Hard</option>
              <option value="BOSS">Boss</option>
            </select>
          </label>
        </div>
        {loading && <p className="state-message">Loading challenges…</p>}
        {!loading && error && (
          <div className="state-message state-error" role="alert">
            <p>{error}</p>
            <button className="text-button" onClick={() => window.location.reload()} type="button">
              Try again
            </button>
          </div>
        )}
        {!loading && !error && filteredBugs.length === 0 && (
          <div className="empty-state">
            <span className="empty-icon">⌕</span>
            <h2>{bugs.length ? "No matching challenges" : "The lab is quiet—for now"}</h2>
            <p>
              {bugs.length
                ? "Try another search or difficulty."
                : "There are no challenges yet. Check back when a new bug is added."}
            </p>
          </div>
        )}
        {!loading && !error && filteredBugs.length > 0 && (
          <div className="challenge-grid">
            {filteredBugs.map((bug) => (
              <Link className="challenge-card" key={bug.id} to={`/challenges/${bug.id}`}>
                <div className="card-meta">
                  <span className={`difficulty difficulty-${bug.difficulty?.toLowerCase()}`}>
                    {bug.difficulty}
                  </span>
                  <span className="card-language">{bug.language}</span>
                </div>
                <h2>{bug.title}</h2>
                <p>{bug.description}</p>
                <div className="card-footer">
                  <span>{bug.topic}</span>
                  <span className="arrow" aria-hidden="true">↗</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </AppShell>
  );
}

function ChallengeDetailPage() {
  const { id } = useParams();
  const { auth, logout } = useAuth();
  const [bug, setBug] = useState(null);
  const [testCases, setTestCases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submittedSolution, setSubmittedSolution] = useState("");
  const [submission, setSubmission] = useState(null);
  const [submissionId, setSubmissionId] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState("");
  const startedAt = useRef(Date.now());
  const pendingRequest = useRef(null);
  const activeSubmissionStorageKey =
    `buglab_submission_${auth?.user?.id}_${id}`;

  const supportsJavaScript =
    bug &&
    ["javascript", "js", "node.js", "node"].includes(
      bug.language.trim().toLowerCase()
    );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setBug(null);
    setSubmission(null);
    setSubmissionId(null);
    setSubmissionError("");
    pendingRequest.current = null;
    Promise.all([
      apiRequest(`/bugs/${id}`, { token: auth.token }),
      apiRequest(`/bugs/${id}/test-cases`, { token: auth.token }),
    ])
      .then(async ([bugResult, testResult]) => {
        if (!active) return;
        setBug(bugResult.bug);
        setTestCases(testResult.testCases || []);
        setSubmittedSolution(
          bugResult.bug.starterCode ||
            "function solve(input) {\n  // Fix the bug here\n}\n"
        );
        startedAt.current = Date.now();
        const saved = readStoredSubmission(activeSubmissionStorageKey);
        if (saved?.submissionId) {
          setSubmissionId(saved.submissionId);
        } else if (saved?.idempotencyKey) {
          try {
            const recovered = await apiRequest(
              `/submissions/by-key/${saved.idempotencyKey}`,
              { token: auth.token }
            );
            if (!active) return;
            setSubmission(recovered);
            setSubmissionId(recovered.submissionId);
            localStorage.setItem(
              activeSubmissionStorageKey,
              JSON.stringify({
                submissionId: recovered.submissionId,
                idempotencyKey: saved.idempotencyKey,
              })
            );
          } catch (recoveryError) {
            if (!active) return;
            if (recoveryError.status === 401) {
              logout();
              return;
            }
            if (recoveryError.status === 404) {
              localStorage.removeItem(activeSubmissionStorageKey);
            } else {
              setSubmissionError(recoveryError.message);
            }
          }
        }
      })
      .catch((requestError) => {
        if (!active) return;
        if (requestError.status === 401) {
          logout();
          return;
        }
        setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [activeSubmissionStorageKey, auth.token, id, logout]);

  useEffect(() => {
    if (!submissionId || !auth?.token) return undefined;
    let active = true;
    let timer;
    let delayMs = 750;

    const pollSubmission = async () => {
      try {
        const result = await apiRequest(`/submissions/${submissionId}`, {
          token: auth.token,
        });
        if (!active) return;
        setSubmission(result);
        setSubmissionError("");
        if (result.status === "COMPLETED" || result.status === "FAILED") {
          if (
            storedSubmissionMatches(
              activeSubmissionStorageKey,
              submissionId
            )
          ) {
            localStorage.removeItem(activeSubmissionStorageKey);
          }
          pendingRequest.current = null;
          setSubmissionId(null);
          return;
        }
      } catch (requestError) {
        if (!active) return;
        if (requestError.status === 401) {
          logout();
          return;
        }
        if (requestError.status === 404) {
          localStorage.removeItem(activeSubmissionStorageKey);
          setSubmissionId(null);
          setSubmissionError("Submission status is no longer available.");
          return;
        }
        setSubmissionError(requestError.message);
      }

      timer = setTimeout(pollSubmission, delayMs);
      delayMs = Math.min(Math.round(delayMs * 1.6), 5000);
    };

    pollSubmission();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [activeSubmissionStorageKey, auth?.token, logout, submissionId]);

  const runCode = async (event) => {
    event.preventDefault();
    setSubmitting(true);
    setSubmission(null);
    setSubmissionError("");

    try {
      const previousRequest = pendingRequest.current;
      const isRetry =
        previousRequest?.submittedSolution === submittedSolution;
      const idempotencyKey = isRetry
        ? previousRequest.idempotencyKey
        : crypto.randomUUID();
      const timeSpent = isRetry
        ? previousRequest.timeSpent
        : Math.min(
            86400,
            Math.floor((Date.now() - startedAt.current) / 1000)
          );
      pendingRequest.current = {
        idempotencyKey,
        submittedSolution,
        timeSpent,
      };
      localStorage.setItem(
        activeSubmissionStorageKey,
        JSON.stringify({ idempotencyKey })
      );
      const result = await apiRequest(`/bugs/${id}/attempt`, {
        token: auth.token,
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          submittedSolution,
          timeSpent,
        }),
      });
      setSubmission({
        submissionId: result.submissionId,
        status: result.status,
        progress: { completed: 0, total: 0 },
        results: [],
      });
      setSubmissionId(result.submissionId);
      localStorage.setItem(
        activeSubmissionStorageKey,
        JSON.stringify({
          submissionId: result.submissionId,
          idempotencyKey,
        })
      );
    } catch (requestError) {
      if (requestError.status === 401) {
        logout();
        return;
      }
      setSubmissionError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <section className="detail-page">
        <Link className="back-link" to="/challenges">← All challenges</Link>
        {loading && <p className="state-message">Loading challenge…</p>}
        {!loading && error && <p className="form-error" role="alert">{error}</p>}
        {!loading && !error && bug && (
          <>
            <div className="detail-heading">
              <div className="card-meta">
                <span className={`difficulty difficulty-${bug.difficulty?.toLowerCase()}`}>
                  {bug.difficulty}
                </span>
                <span className="card-language">{bug.language}</span>
                <span className="topic-label">{bug.topic}</span>
              </div>
              <h1>{bug.title}</h1>
            </div>
            <div className="detail-grid">
              <article className="detail-card">
                <p className="eyebrow">BUG REPORT</p>
                <h2>What’s going wrong?</h2>
                <p className="bug-description">{bug.description}</p>
                {supportsJavaScript ? (
                  <form className="code-workspace" onSubmit={runCode}>
                    <label className="code-editor-label" htmlFor="solution-editor">
                      JavaScript solution
                    </label>
                    <textarea
                      id="solution-editor"
                      className="code-editor"
                      aria-label="JavaScript solution"
                      autoCapitalize="off"
                      autoComplete="off"
                      autoCorrect="off"
                      spellCheck="false"
                      value={submittedSolution}
                      onChange={(event) =>
                        setSubmittedSolution(event.target.value)
                      }
                    />
                    <button
                      className="primary-button"
                      type="submit"
                      disabled={
                        submitting ||
                        Boolean(submissionId) ||
                        !submittedSolution.trim()
                      }
                    >
                      {submitting ? "Queueing…" : "Run code"}
                    </button>
                    {submissionError && (
                      <p className="form-error" role="alert">
                        {submissionError}
                      </p>
                    )}
                    {submission && (
                      <section
                        className="submission-results"
                        aria-live="polite"
                        aria-label="Submission results"
                      >
                        <h3>
                          {submission.status === "QUEUED" && "Queued"}
                          {submission.status === "RUNNING" && "Running tests"}
                          {submission.status === "FAILED" && "Runner unavailable"}
                          {submission.status === "COMPLETED" &&
                            (submission.solved
                              ? `Solved · +${submission.xpAwarded} XP`
                              : "Some tests failed")}
                        </h3>
                        {(submission.status === "QUEUED" ||
                          submission.status === "RUNNING") && (
                          <p className="muted">
                            {submission.status === "QUEUED"
                              ? "Waiting for an isolated worker."
                              : `Completed ${submission.progress.completed} of ${submission.progress.total} tests.`}
                          </p>
                        )}
                        {submission.status === "FAILED" && (
                          <p className="form-error" role="alert">
                            {submission.message}
                          </p>
                        )}
                        {submission.alreadySolved && (
                          <p className="muted">
                            This challenge was already solved; no extra XP was
                            awarded.
                          </p>
                        )}
                        {submission.results.map((result) => (
                          <div
                            className="submission-result"
                            key={result.index}
                          >
                            <div>
                              <span>
                                {result.hidden
                                  ? `Hidden test ${result.index}`
                                  : `Test ${result.index}`}
                              </span>
                              {!result.hidden && (
                                <pre className="submission-output">
                                  Input: {result.input}
                                  {"\n"}Expected: {result.expectedOutput}
                                  {"\n"}Received: {result.actualOutput}
                                </pre>
                              )}
                            </div>
                            <span
                              className={
                                result.passed
                                  ? "test-status"
                                  : "test-status state-error"
                              }
                            >
                              {result.passed ? "Passed" : "Failed"}
                              {result.timedOut ? " · Timed out" : ""}
                            </span>
                          </div>
                        ))}
                      </section>
                    )}
                  </form>
                ) : (
                  <div className="coming-soon">
                    <span className="coming-soon-mark">↗</span>
                    <div>
                      <strong>JavaScript runner only</strong>
                      <p>
                        This challenge uses {bug.language}. Only JavaScript
                        challenges can be run in this milestone.
                      </p>
                    </div>
                  </div>
                )}
              </article>
              <aside className="detail-card test-card">
                <p className="eyebrow">TESTS</p>
                <h2>{testCases.length} test cases</h2>
                <p className="muted">
                  Hidden test inputs and expected outputs are kept private.
                </p>
                <div className="test-list">
                  {testCases.map((testCase, index) => (
                    <div className="test-row" key={testCase.id}>
                      <span className="test-number">#{String(index + 1).padStart(2, "0")}</span>
                      <span>{testCase.isHidden ? "Hidden test" : "Visible test"}</span>
                      <span className="test-status">Ready</span>
                    </div>
                  ))}
                  {testCases.length === 0 && <p className="muted">No tests have been added yet.</p>}
                </div>
              </aside>
            </div>
          </>
        )}
      </section>
    </AppShell>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/challenges" replace />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      <Route
        path="/challenges"
        element={<ProtectedRoute><ChallengesPage /></ProtectedRoute>}
      />
      <Route
        path="/challenges/:id"
        element={<ProtectedRoute><ChallengeDetailPage /></ProtectedRoute>}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
