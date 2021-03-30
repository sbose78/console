// Type for extension hook
export type ExtensionHook<T, R = any> = (options: R) => ExtensionHookResult<T>;

// Type for extension hook result that returns [data, resolved, error]
export type ExtensionHookResult<T> = [T, boolean, any];
