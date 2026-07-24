/**
 * Built-in permission rules and read-safe bash patterns.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │  To add a new allowed command: append its glob to the right section │
 * │  To add a command that needs confirmation: add to ASK section       │
 * │  Rules are evaluated top-to-bottom — first match wins.              │
 * └──────────────────────────────────────────────────────────────────────┘
 */

import type { BashRule } from "./types.js";

// ── Built-in Rules (evaluated in order, first match wins) ──────────────

export const BUILTIN_RULES: BashRule[] = [
	// ── Always ask ─────────────────────────────────────────────────────
	{ action: "ask", patterns: ["*git*push*"] },

	// ── System info / read-only commands ──────────────────────────────
	{
		action: "allow",
		patterns: [
			"ls", "ls *", "dir", "dir *", "cat *", "head *", "tail *", "less *", "more *",
			"grep *", "egrep *", "fgrep *", "tree", "tree *", "file *", "wc *", "pwd",
			"stat *", "du *", "df *", "ps *", "top", "htop", "echo *", "printenv *", "id",
			"which *", "whereis *", "date", "cal *", "uptime", "free *", "ping *", "dig *",
			"nslookup *", "host *", "netstat *", "ss *", "lsof *", "ifconfig *", "ip *",
			"man *", "info *", "mkdir *", "touch *", "uname *", "whoami",
		],
	},

	// ── Language version / help ────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"go version", "go env *", "go help *",
			"cargo version", "cargo --version", "cargo help *",
			"rustc --version", "rustc --help", "rustc --explain *",
			"javac --version", "javac -version", "javac -help", "javac --help",
			"dotnet --info", "dotnet --version", "dotnet --help", "dotnet help *",
			"gcc --version", "gcc -v", "gcc --help", "gcc -dumpversion",
			"g++ --version", "g++ -v", "g++ --help", "g++ -dumpversion",
			"clang --version", "clang --help", "clang++ --version", "clang++ --help",
			"python -V", "python --version", "python -h", "python --help",
			"python3 -V", "python3 --version", "python3 -h", "python3 --help",
			"ruby -v", "ruby --version", "ruby -h", "ruby --help",
			"node -v", "node --version", "node -h", "node --help",
			"npm --help", "npm --version", "npm -v", "npm help *",
			"yarn --help", "yarn --version", "yarn -v", "yarn help *",
			"pnpm --help", "pnpm --version", "pnpm -v", "pnpm help *",
			"pytest -h", "pytest --help", "pytest --version",
			"jest --help", "jest --version", "mocha --help", "mocha --version",
			"make --version", "make --help",
			"docker --version", "docker --help", "docker version", "docker help *",
			"git --version", "git --help", "git help *", "git version",
		],
	},

	// ── Build / test / list ───────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"go test *", "go run *", "go build *", "go vet *", "go fmt *", "go list *",
			"cargo test *", "cargo run *", "cargo build *", "cargo check *", "cargo fmt *", "cargo tree *",
			"make -n *", "make --dry-run *",
			"mvn test *", "mvn verify *", "mvn dependency:tree *",
			"gradle tasks *", "gradle dependencies *", "gradle properties *",
			"dotnet test *", "dotnet list *",
			"python -c *", "ruby -e *", "node -e *",
			"npm list *", "npm ls *", "npm outdated *", "npm test*", "npm run*", "npm view *", "npm info *",
			"yarn list*", "yarn ls *", "yarn info *", "yarn test*", "yarn run *", "yarn why *",
			"pnpm list*", "pnpm ls *", "pnpm outdated *", "pnpm test*", "pnpm run *",
			"pytest --collect-only *", "jest --listTests *", "jest --showConfig *", "mocha --list *",
			"git status*", "git show *", "git diff*", "git grep *", "git branch *", "git tag *",
			"git remote -v *", "git rev-parse --is-inside-work-tree *", "git rev-parse --show-toplevel *",
			"git config --list *", "git log *",
		],
	},

	// ── Build tools / bundlers ────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"./gradlew *", "./mvnw *", "./build.sh *", "./configure *", "cmake *",
			"./node_modules/.bin/tsc *", "./node_modules/.bin/eslint *",
			"./node_modules/.bin/prettier *", "prettier *",
			"./node_modules/.bin/tailwindcss *", "./node_modules/.bin/tsx *",
			"./node_modules/.bin/vite *", "bun *", "tsx *", "vite *",
		],
	},

	// ── Python virtualenvs / package managers ─────────────────────────
	{
		action: "allow",
		patterns: [
			".venv/bin/activate *", ".venv/Scripts/activate *",
			"source .venv/bin/activate *", "source venv/bin/activate *",
			"pip list *", "pip show *", "pip check *", "pip freeze *",
			"uv *", "poetry show *", "poetry check *", "pipenv check *",
		],
	},

	// ── Version managers ──────────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"asdf list *", "asdf current *", "asdf which *",
			"mise list *", "mise current *", "mise which *", "mise use *",
			"rbenv version *", "rbenv versions *", "rbenv which *",
			"nvm list *", "nvm current *", "nvm which *",
		],
	},

	// ── Test runners / linters ────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"./test*", "./run_tests.sh *", "./run_*_tests.sh *", "vitest *",
			"bundle exec rspec *", "bundle exec rubocop *", "rspec *", "rubocop *",
			"swiftlint *", "clippy *", "ruff *", "black *", "isort *",
			"mypy *", "flake8 *", "bandit *", "safety *", "biome check *", "biome format *",
		],
	},

	// ── Web servers ───────────────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"rails server *", "rails s *", "bin/rails server *", "bin/rails s *",
			"flask run *", "django-admin runserver *", "python manage.py runserver *",
			"uvicorn *", "streamlit run *",
		],
	},

	// ── Database introspection ────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"bin/rails db:status", "bin/rails db:version",
			"rails db:rollback *", "rails db:status *", "rails db:version *",
			"alembic current *", "alembic history *",
			"bundle exec rails db:status", "bundle exec rails db:version",
		],
	},

	// ── Container introspection ───────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"docker ps *", "docker images *", "docker logs *", "docker inspect *",
			"docker info *", "docker stats *", "docker system df *", "docker system info *",
			"podman ps *", "podman images *", "podman logs *", "podman inspect *", "podman info *",
		],
	},

	// ── Cloud / k8s introspection ─────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"aws --version *", "aws configure list *", "aws sts get-caller-identity *", "aws s3 ls *",
			"gcloud config list *", "gcloud auth list *", "gcloud projects list *",
			"az account list *", "az account show *",
			"kubectl get *", "kubectl describe *", "kubectl logs *", "kubectl version *",
			"helm list *", "helm status *", "helm version *",
		],
	},

	// ── Compiled languages ────────────────────────────────────────────
	{
		action: "allow",
		patterns: [
			"swift build *", "swift test *", "zig build *", "zig build test*",
			"kotlinc *", "scalac *", "javac *", "javap *", "clang *", "jar *",
			"sbt *", "gradle *", "bazel build *", "bazel test *", "bazel run *",
			"mix *", "lua *", "ruby *", "php *",
		],
	},

	// ── Filesystem helpers ────────────────────────────────────────────
	{ action: "allow", patterns: ["mkdir -p *", "chmod +x *", "dos2unix *", "unix2dos *", "ln -s *"] },

	// ── Shell control flow — ask ──────────────────────────────────────
	{
		action: "ask",
		patterns: [
			"for *", "while *", "do *", "done *", "if *", "then *", "else *",
			"elif *", "fi *", "case *", "esac *", "in *", "function *",
			"select *", "until *", "{ *", "} *", "[[ *", "]] *",
		],
	},

	// ── Regex-based fine-grained rules ────────────────────────────────
	{ action: "allow", patterns: ["/^find(?!.*(-delete|-exec|-execdir)).*$/"] },
	{ action: "allow", patterns: ["/^(echo|ls|pwd|date|whoami|id|uname)\\s.*[&|;].*\\s*(echo|ls|pwd|date|whoami|id|uname)($|\\s.*)/" ] },
	{ action: "allow", patterns: ["/^(cat|grep|head|tail|less|more|find)\\s.*\\|\\s*(grep|head|tail|less|more|wc|sort|uniq)($|\\s.*)/" ] },
	{ action: "ask",   patterns: ["/^rm\\s+.*(-[rf].*-[rf]|-[rf]{2,}|--recursive.*--force|--force.*--recursive).*$/"] },
	{ action: "ask",   patterns: ["/^find.*(-delete|-exec|-execdir).*$/"] },
	{ action: "allow", patterns: ["/^(ls|cat|grep|head|tail|file|stat)\\s+[^/]*$/"] },
	{ action: "allow", patterns: ["/^(?!.*(rm|mv|cp|chmod|chown|sudo|su|dd)\\b).*/dev/(null|zero|stdout|stderr|stdin).*$/"] },

	// ── Default: ask for any unmatched bash command ───────────────────
	{ action: "ask", patterns: ["*"] },
];

// ── Read-only Mode Patterns ────────────────────────────────────────────

export const READ_SAFE_PATTERNS: RegExp[] = [
	/^\s*(cat|head|tail|less|more|bat)\b/,
	/^\s*(grep|egrep|fgrep|rg)\b/,
	/^\s*find\b/,
	/^\s*(ls|ll|la|dir|pwd|tree|file|stat|du|df)\b/,
	/^\s*(wc|sort|uniq|diff|comm|cut|tr|rev)\b/,
	/^\s*(echo|printf)\b/,
	/^\s*(which|whereis|type|command\s+-v)\b/,
	/^\s*(env|printenv)\b/,
	/^\s*(uname|whoami|id|date|cal|uptime|hostname)\b/,
	/^\s*(ps|top|htop|free)\b/,
	/^\s*git\s+(status|log|diff|show|branch|remote|tag|config\s+--get|config\s+--list|rev-parse|ls-files|ls-tree|describe|version|--version|--help)\b/i,
	/^\s*(node|python|python3|ruby|go|cargo|rustc|java|javac|gcc|g\+\+|clang|dotnet|swift)\s+(-v|--version|--help|-h|-V)\b/,
	/^\s*(npm|yarn|pnpm)\s+(list|ls|view|info|search|outdated|audit|--version|-v|--help|help)\b/,
	/^\s*(pip|pip3)\s+(list|show|check|freeze|--version|-V)\b/,
	/^\s*(jq|yq|awk)\b/,
	/^\s*sed\s+-n\b/,
	/^\s*(fd)\b/,
	/^\s*(docker|podman)\s+(ps|images|logs|inspect|info|stats|version|--version|--help)\b/,
	/^\s*(kubectl)\s+(get|describe|logs|version|--help)\b/,
	/^\s*(realpath|basename|dirname|readlink)\b/,
	/^\s*(md5sum|sha256sum|shasum|cksum)\b/,
	/^\s*(xargs)\b/,
	/^\s*(column|nl|expand|unexpand|fold|fmt|tac)\b/,
];
