import { defineApp } from 'blendx';

export default defineApp({
  hooks: {
    authorize({ prev }) {
      return prev;
    },
  },
});
