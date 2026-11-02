const { getDefaultConfig } = require("expo/metro-config");

/**
 * SDK 58 resolves workspace packages itself ("Expo Autolinking module
 * resolution enabled"), so no hand-rolled monorepo resolver is needed. An
 * earlier version of this file set watchFolders, nodeModulesPaths and
 * disableHierarchicalLookup; that combination broke React Native's own
 * environment setup at runtime.
 *
 * If this app ever imports @beaive/schemas from the workspace root and Metro
 * cannot find it, re-add watchFolders for the workspace root first, and only
 * then consider the resolver options - disableHierarchicalLookup is what
 * caused the breakage.
 */
module.exports = getDefaultConfig(__dirname);
