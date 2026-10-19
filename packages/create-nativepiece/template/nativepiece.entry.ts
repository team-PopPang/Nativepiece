import { defineModule } from '@nativepiece/runtime';
import contract from './nativepiece.contract';
import { HomeScreen } from './src/screens/HomeScreen';

export default defineModule(contract, {
  home: HomeScreen,
});
