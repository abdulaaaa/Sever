import '../../assets/styles/theme.css';
import Options from './Options.svelte';
import { mount } from 'svelte';

const app = mount(Options, {
  target: document.getElementById('app')!
});

export default app;
