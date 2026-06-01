declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '@expo/vector-icons' {
  import * as React from 'react';
  export const Ionicons: React.ComponentType<any>;
  export const Crown: React.ComponentType<any>;
}
