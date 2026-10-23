declare const __T3CODE_BUILD_DESKTOP_IDENTITY__:
  | {
      readonly productName: string;
      readonly homeDir: string;
      readonly userDataDir: string;
    }
  | undefined;

/**
 * Who this desktop build is. Official builds and tests keep T3 Code's own name and folders; a
 * fork sets T3CODE_DESKTOP_PRODUCT_NAME, T3CODE_DESKTOP_HOME_DIR, and
 * T3CODE_DESKTOP_USER_DATA_DIR when building so its app installs beside the official one
 * instead of sharing its database and Electron profile.
 */
const built =
  typeof __T3CODE_BUILD_DESKTOP_IDENTITY__ === "undefined"
    ? undefined
    : __T3CODE_BUILD_DESKTOP_IDENTITY__;

export const desktopBuildIdentity = {
  productName: built?.productName || "T3 Code",
  /** The T3 home folder in the user's home directory, unless T3CODE_HOME says otherwise. */
  homeDir: built?.homeDir || ".t3",
  /** The packaged app's Electron profile folder under the platform's app data directory. */
  userDataDir: built?.userDataDir || "t3code-v2",
};
