const { withAppBuildGradle } = require("expo/config-plugins");

/**
 * Signs release builds with Moshlet's own release key instead of the public debug key, and stops a
 * release build that can't find it. The key and its passwords stay outside the repo: Gradle reads
 * them from ~/.gradle/gradle.properties (or ORG_GRADLE_PROJECT_* environment variables):
 *
 *   MOSHLET_RELEASE_STORE_FILE=/path/to/moshlet-release.jks
 *   MOSHLET_RELEASE_KEY_ALIAS=moshlet
 *   MOSHLET_RELEASE_STORE_PASSWORD=...
 *   MOSHLET_RELEASE_KEY_PASSWORD=...
 */
const MARK = "MOSHLET_RELEASE_STORE_FILE";

const RELEASE_CONFIG = `
        release {
            if (findProperty('MOSHLET_RELEASE_STORE_FILE')) {
                storeFile file(findProperty('MOSHLET_RELEASE_STORE_FILE'))
                storePassword findProperty('MOSHLET_RELEASE_STORE_PASSWORD')
                keyAlias findProperty('MOSHLET_RELEASE_KEY_ALIAS')
                keyPassword findProperty('MOSHLET_RELEASE_KEY_PASSWORD')
            }
        }`;

const GUARD = `
// A release build is signed with Moshlet's release key, never the public debug key.
gradle.taskGraph.whenReady { graph ->
    def signs = graph.allTasks.any { it.project == project && (it.name == 'packageRelease' || it.name == 'signReleaseBundle') }
    if (signs && !findProperty('MOSHLET_RELEASE_STORE_FILE')) {
        throw new GradleException("Release builds need Moshlet's release key: set MOSHLET_RELEASE_STORE_FILE, MOSHLET_RELEASE_KEY_ALIAS, MOSHLET_RELEASE_STORE_PASSWORD and MOSHLET_RELEASE_KEY_PASSWORD in ~/.gradle/gradle.properties")
    }
}
`;

function sign(gradle) {
  if (gradle.includes(MARK)) return gradle;
  const debugConfig = /(signingConfigs \{\n\s*debug \{[^}]*\})/;
  const releaseType = /(buildTypes \{[\s\S]*?\n\s*release \{[^}]*?)signingConfig signingConfigs\.debug/;
  if (!debugConfig.test(gradle) || !releaseType.test(gradle)) {
    throw new Error("release-signing: app/build.gradle no longer looks as expected, so release signing couldn't be set up");
  }
  return gradle.replace(debugConfig, `$1${RELEASE_CONFIG}`).replace(releaseType, "$1signingConfig signingConfigs.release") + GUARD;
}

module.exports = (config) =>
  withAppBuildGradle(config, (c) => {
    c.modResults.contents = sign(c.modResults.contents);
    return c;
  });
