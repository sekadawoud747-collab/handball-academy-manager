مشروع أندرويد لتغليف نسخة HTML الحالية كتطبيق WebView.

مهم:
- هذا ليس ملف APK جاهزًا للتثبيت؛ إنه مشروع مصدر يحتاج Android Studio/Android SDK لبناء APK.
- نسخة HTML الحالية تخزن البيانات محليًا فقط، ولا تتصل بـ Supabase. لا تعتبر هذه النسخة نهائية أو آمنة للاستخدام الحقيقي قبل تنفيذ واختبار الربط والصلاحيات.

طريقة البناء على كمبيوتر:
1) افتح Android Studio واختر Open ثم مجلد HandballAcademyAndroid.
2) انتظر مزامنة Gradle وتثبيت Android SDK المطلوب عند الطلب.
3) من القائمة Build اختر Build APK(s).
4) ستجد APK عادة داخل app/build/outputs/apk/debug/app-debug.apk.
