import { useEffect, useState, type FormEvent } from "react";
import { ApiError, api, refreshSession, type User } from "./api";
import { dict, type Lang } from "./i18n";

type Screen = { name: "loading" } | { name: "phone" } | { name: "code"; phone: string } | { name: "home"; user: User };

const savedLang = (): Lang => {
  try {
    return localStorage.getItem("lang") === "uz" ? "uz" : "ru";
  } catch {
    return "ru";
  }
};

export function App() {
  const [lang, setLang] = useState<Lang>(savedLang);
  const [screen, setScreen] = useState<Screen>({ name: "loading" });
  const [phone, setPhone] = useState("+998 ");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = dict[lang];

  const switchLang = (next: Lang) => {
    setLang(next);
    try {
      localStorage.setItem("lang", next);
    } catch {
      /* приватный режим — не страшно */
    }
  };

  // При открытии пробуем продолжить прошлую сессию по cookie.
  useEffect(() => {
    void (async () => {
      if (await refreshSession()) {
        try {
          const user = await api.me();
          switchLang(user.lang);
          return setScreen({ name: "home", user });
        } catch {
          /* упадём на экран входа */
        }
      }
      setScreen({ name: "phone" });
    })();
  }, []);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError) {
        const left = (e.details as { attempts_left?: number } | undefined)?.attempts_left;
        const message = t.errors[e.code] ?? e.message;
        setError(left === undefined ? message : `${message}. ${t.attemptsLeft}: ${left}`);
      } else setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onPhone = (e: FormEvent) => {
    e.preventDefault();
    if (phone.replace(/\D/g, "").length !== 12) return setError(t.wrongPhone);
    void run(async () => {
      await api.requestCode(phone);
      setCode("");
      setScreen({ name: "code", phone });
    });
  };

  const onCode = (e: FormEvent) => {
    e.preventDefault();
    if (screen.name !== "code") return;
    void run(async () => {
      const user = await api.verifyCode(screen.phone, code);
      switchLang(user.lang);
      setScreen({ name: "home", user });
    });
  };

  const onLang = (next: Lang) => {
    switchLang(next);
    if (screen.name === "home") void run(async () => setScreen({ name: "home", user: await api.updateMe({ lang: next }) }));
  };

  return (
    <main className="page">
      <header className="top">
        <div>
          <h1>FAKT</h1>
          <p className="muted">{t.tagline}</p>
        </div>
        <div className="langs">
          {(["ru", "uz"] as const).map((l) => (
            <button key={l} type="button" className={l === lang ? "lang active" : "lang"} onClick={() => onLang(l)}>
              {l === "ru" ? "RU" : "UZ"}
            </button>
          ))}
        </div>
      </header>

      {screen.name === "loading" && <p className="muted">{t.loading}</p>}

      {screen.name === "phone" && (
        <form onSubmit={onPhone} className="card">
          <label htmlFor="phone">{t.phoneLabel}</label>
          <input
            id="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={busy}>
            {t.getCode}
          </button>
        </form>
      )}

      {screen.name === "code" && (
        <form onSubmit={onCode} className="card">
          <p className="muted">
            {t.codeSentTo} {screen.phone}
          </p>
          <label htmlFor="code">{t.codeLabel}</label>
          <input
            id="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
          <button type="submit" disabled={busy || code.length !== 6}>
            {t.signIn}
          </button>
          <div className="row">
            <button type="button" className="link" onClick={() => setScreen({ name: "phone" })}>
              {t.changePhone}
            </button>
            <button type="button" className="link" disabled={busy} onClick={() => run(() => api.requestCode(screen.phone))}>
              {t.resend}
            </button>
          </div>
        </form>
      )}

      {screen.name === "home" && (
        <section className="card">
          <h2>
            {t.hello}, {screen.user.full_name}
          </h2>
          <dl>
            <dt>{t.company}</dt>
            <dd>{screen.user.company.name}</dd>
            <dt>{screen.user.role === "owner" ? t.roleOwner : t.roleForeman}</dt>
            <dd>{screen.user.phone}</dd>
            <dt>{t.telegram}</dt>
            <dd>{screen.user.telegram_linked ? t.linked : t.notLinked}</dd>
          </dl>
          <button
            type="button"
            className="secondary"
            onClick={() =>
              run(async () => {
                await api.logout();
                setScreen({ name: "phone" });
              })
            }
          >
            {t.logout}
          </button>
        </section>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
