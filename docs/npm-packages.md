# npm 패키지 만들기와 새 버전 올리기

Nativepiece의 npm 패키지 3개가 어떻게 만들어지는지, 새 버전은 어떻게 올리는지 정리했어요.

> 이 문서는 RN 모듈을 **만드는 쪽**에서 쓰는 npm 패키지만 다뤄요. 앱이 받는 iOS Swift Package와 Android AAR은 모듈마다 `nativepiece publish ios|android`로 따로 배포해요([README](../README.md#ios-배포) 참고).

## 패키지 구성

| 패키지 | 폴더 | 역할 | 쓰는 곳 |
|---|---|---|---|
| `@team-poppang/create-nativepiece` | `packages/create-nativepiece` | 새 모듈 프로젝트를 만들어요 | `npm init @team-poppang/nativepiece my-module` 할 때 한 번 |
| `@team-poppang/nativepiece-cli` | `packages/cli` | `nativepiece build`, `publish` 같은 명령어 | 모듈 프로젝트의 `devDependencies` |
| `@team-poppang/nativepiece-runtime` | `packages/runtime` | RN 화면이 호스트 앱과 통신하는 JS API와 네이티브 모듈 | 모듈 프로젝트의 `dependencies` (앱 결과물 안에 들어가요) |

세 패키지는 **항상 같은 버전으로** 올려요. `create-nativepiece`는 새 프로젝트를 만들 때 자기 버전으로 cli와 runtime 의존성을 적기 때문이에요(예: `create-nativepiece@0.1.1`로 만들면 `"@team-poppang/nativepiece-cli": "^0.1.1"`).

## 저장소

- 패키지는 **GitHub Packages**(team-PopPang 조직 전용 npm 저장소)에 올라가요. npmjs.com에는 올리지 않아요.
- 각 `package.json`의 `publishConfig.registry`가 `https://npm.pkg.github.com`이라 `npm publish`를 하면 이곳으로 가요.
- GitHub Packages의 npm 패키지 이름은 조직 이름으로 시작해야 해서 모두 `@team-poppang/`로 시작해요.
- 올라간 패키지는 https://github.com/orgs/team-PopPang/packages 에서 볼 수 있어요.

## 패키지가 만들어지는 과정

`npm run build`(레포 루트)를 실행하면 세 패키지가 다음처럼 빌드돼요.

| 패키지 | 빌드 | 패키지에 들어가는 파일 (`files`) |
|---|---|---|
| cli | `tsc`로 `src/` → `dist/`. 이어서 `scripts/copy-hosts.mjs`가 `packages/ios-host`, `android-host`, `android-compose`를 `assets/`로 복사해요 | `dist/`, `assets/` (빌드 스크립트, Gradle wrapper, 호스트 SDK 소스) |
| runtime | 빌드하지 않아요. TS 소스를 그대로 올려요 (Metro가 번들링해요) | `src/`, `ios/`, `android/`, `NativepieceRuntime.podspec`, `react-native.config.js` |
| create-nativepiece | `tsc`로 `src/` → `dist/` | `dist/`, `template/` |

패키지에 들어갈 파일 목록은 올리기 전에 이렇게 확인할 수 있어요.

```bash
cd packages/cli && npm pack --dry-run
```

> 템플릿의 `.gitignore`와 `.npmrc`는 npm이 패키지에서 빼 버리는 파일이라, `_gitignore`와 `_npmrc`라는 이름으로 두고 프로젝트를 만들 때 이름을 바꿔요.

## 로컬에서 개발하고 테스트하기

발행하지 않은 코드로 새 모듈을 만들어 볼 때는 `--nativepiece` 옵션으로 로컬 레포를 가리켜요.

```bash
npm install
npm run build

# 로컬 패키지를 복사해서 설치해요 (npm install --install-links)
node packages/create-nativepiece/dist/index.js ~/tmp/my-module --group com.example --nativepiece "$(pwd)"
cd ~/tmp/my-module
npx nativepiece doctor
npx nativepiece build android
```

cli나 runtime을 고친 뒤 다시 확인하려면, 위 프로젝트의 `node_modules/@team-poppang/*`를 지우고 `npm install`을 다시 하거나 새로 만들어요.

## 새 버전 올리기

버튼 한 번으로 올려요. 버전 번호를 손으로 바꾸거나 태그를 직접 만들 필요가 없어요.

### 1. PR에 라벨 붙이기

릴리스 노트는 지난 릴리스 뒤에 머지된 PR의 라벨로 자동 작성돼요(PopPang-iOS와 같은 방식이에요).

| 라벨 | 릴리스 노트 분류 |
|---|---|
| `✨ feature` | ✨ 새로운 기능이 추가되었어요 |
| `🔧 fix`, `🔥 hotfix` | 🐞 자잘한 버그를 수정했어요 |
| `⚙️ chore`, `🔨 refactor`, `✅ test`, `📃 docs` | 🛠 코드를 개선했어요 |
| 라벨 없음 | 기타 변경 |

### 2. Release 실행하기

GitHub의 **Actions → Release → Run workflow**에서 고르고 실행해요. 브랜치는 `main`이어야 해요.

| 입력 | 값 | 설명 |
|---|---|---|
| `bump` | `patch` / `minor` / `major` / `custom` | 지금 버전에서 자동으로 계산해요. 예: `0.1.0` + `patch` → `0.1.1` |
| `version` | 예: `0.2.0-beta.1` | `bump`가 `custom`일 때만 써요 |
| `release_mode` | `latest` / `draft` | `draft`는 아무것도 발행하지 않고 확인과 릴리스 노트 초안만 만들어요 |

터미널에서는 이렇게 실행해요.

```bash
gh workflow run release.yml -f bump=patch                         # 0.1.0 → 0.1.1
gh workflow run release.yml -f bump=minor -f release_mode=draft   # 발행 전에 미리 확인
gh workflow run release.yml -f bump=custom -f version=0.2.0-beta.1
```

어떤 걸 고를지는 [semver](https://semver.org/lang/ko/) 규칙을 따라요.

| 바꾼 내용 | bump |
|---|---|
| 버그 수정 | `patch` |
| 기능 추가 (기존 사용법은 그대로) | `minor` |
| 사용법이 바뀌는 변경 | 1.0 전에는 `minor`, 1.0 이후에는 `major` |

### 3. 워크플로가 하는 일

`.github/workflows/release.yml`이 아래를 차례로 해요.

| 단계 | 내용 | draft |
|---|---|---|
| 버전 계산·검증 | 세 패키지 버전이 같은지, 새 버전 형식이 맞는지, 같은 태그가 없는지 확인해요 | 같음 |
| 버전 올리기 | `npm version <버전> --workspaces`로 세 `package.json`과 `package-lock.json`을 바꿔요 | 같음 (커밋 안 함) |
| 빌드·검사 | `npm run build`, `typecheck`, `npm pack --dry-run` | 같음 |
| 커밋·태그 | `Release v<버전>` 커밋을 `main`에 올리고 `v<버전>` 태그를 붙여요 | 건너뜀 |
| npm 발행 | runtime → cli → create-nativepiece 순서로 GitHub Packages에 올려요 | `--dry-run` |
| GitHub Release | `release-drafter`로 라벨 기반 릴리스 노트를 만들고 공개해요 | Draft Release만 |
| 발행 검증 | `verify-published.yml`을 호출해요. 레지스트리에서 `npm init`으로 새 모듈을 만들어 Android(Linux)와 iOS(macOS, RN 0.86)로 빌드해요 | 건너뜀 |

- 인증은 GitHub Actions가 주는 `GITHUB_TOKEN`을 써요. 개인 토큰은 필요 없어요.
- 동시에 두 번 실행되지 않아요.
- 실행 결과 화면의 Summary에 커밋·태그 여부와 발행된 패키지가 남아요.

발행 검증만 다시 돌리려면 이렇게 해요.

```bash
gh workflow run verify-published.yml -f version=0.1.1 -f ios=true
```

## 받아 쓰는 쪽 설정

비공개 저장소라서 받는 사람도 토큰이 필요해요. 사용자 홈의 `~/.npmrc`에 한 번만 넣어요.

```
@team-poppang:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=<read:packages 권한이 있는 GitHub 토큰>
```

- `gh`를 쓰면 `gh auth refresh -s read:packages`로 권한을 추가하고 `gh auth token` 값을 넣으면 돼요.
- CI에서는 `actions/setup-node`의 `registry-url`, `scope`를 설정하고 `NODE_AUTH_TOKEN`으로 토큰을 넘겨요. 다른 레포의 Actions에서 받으려면 패키지 설정(Package settings → Manage Actions access)에서 그 레포에 읽기 권한을 줘야 해요.
- 모듈 프로젝트의 `.npmrc`에는 레지스트리 주소(`@team-poppang:registry=...`)만 있어요. 토큰은 레포에 커밋하지 않아요.

## 문제 해결

| 증상 | 원인 | 해결 |
|---|---|---|
| "Resolve version"에서 실패 | 세 패키지 버전이 서로 다르거나 custom 버전 형식이 틀렸어요 | 세 `package.json`의 version을 맞추거나 `x.y.z` 형식으로 다시 입력해요 |
| "Check tag"에서 실패 | 같은 버전이 이미 릴리스됐어요 | 버전을 올려서 다시 실행해요 |
| "Check branch"에서 실패 | `main`이 아닌 브랜치에서 실행했어요 | Run workflow에서 브랜치를 `main`으로 골라요 |
| `npm publish`가 `409 Conflict` | 같은 버전이 이미 올라가 있어요. 같은 번호로는 다시 올릴 수 없어요 | 버전을 올려서 다시 배포해요 |
| `npm install`이 `401`/`403` | 토큰이 없거나 `read:packages` 권한이 없어요 | `~/.npmrc` 토큰과 권한을 확인해요 |
| `npm install`이 `404 Not Found` | `@team-poppang` scope가 GitHub Packages를 가리키지 않아요 | `.npmrc`에 `@team-poppang:registry=https://npm.pkg.github.com`이 있는지 확인해요 |
| 일부 패키지만 올라감 | publish 도중 실패했어요. 커밋과 태그는 이미 올라갔어요 | Summary에서 올라간 패키지를 확인하고, 다음 patch 버전으로 다시 실행해요 |
