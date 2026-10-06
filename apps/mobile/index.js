// نقطة الدخول: التطبيق (expo-router) + معالج ويدجتات الشاشة الرئيسية في أندرويد
import 'expo-router/entry';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';

if (Platform.OS === 'android' && Constants.executionEnvironment !== ExecutionEnvironment.StoreClient) {
  try {
    const { registerWidgetTaskHandler } = require('react-native-android-widget');
    const { widgetTaskHandler } = require('./src/widgets/handler');
    registerWidgetTaskHandler(widgetTaskHandler);
  } catch (e) {
    console.warn('widgets disabled', e);
  }
}
