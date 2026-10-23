#import <Foundation/Foundation.h>
#import <stdlib.h>
#import <string.h>

// Standalone app-local 24-hour UUID helper.
// Never reads or overrides the OS UDID, IDFV, or any other app's identifier.
// No method swizzling, hooking, network requests, or jailbreak dependencies.
static NSString * const kUUIDKey = @"dev.bdrdesign.uuid24h.trial.value.v1";
static NSString * const kExpiresKey = @"dev.bdrdesign.uuid24h.trial.expiry.v1";
static NSTimeInterval const kLifetime = 86400;

static NSString *UUID24H_ValidIdentifierLocked(NSUserDefaults *defaults) {
    NSString *identifier = [defaults stringForKey:kUUIDKey];
    double expiry = [defaults doubleForKey:kExpiresKey];
    if (identifier.length == 0 || expiry <= [[NSDate date] timeIntervalSince1970]) {
        return nil;
    }
    return identifier;
}

// Return malloc-owned UTF-8 (or NULL if not created/expired). Call UUID24HFree.
__attribute__((visibility("default")))
char *UUID24HCopyCurrent(void) {
    @synchronized ([NSUserDefaults standardUserDefaults]) {
        NSString *value = UUID24H_ValidIdentifierLocked([NSUserDefaults standardUserDefaults]);
        return value ? strdup([value UTF8String]) : NULL;
    }
}

// Only called by the app's explicit Generate/Renew button.
__attribute__((visibility("default")))
char *UUID24HCopyGenerate(void) {
    @synchronized ([NSUserDefaults standardUserDefaults]) {
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        NSString *identifier = UUID24H_ValidIdentifierLocked(defaults);
        if (!identifier) {
            identifier = [[NSUUID UUID] UUIDString];
            [defaults setObject:identifier forKey:kUUIDKey];
            [defaults setDouble:([[NSDate date] timeIntervalSince1970] + kLifetime)
                         forKey:kExpiresKey];
        }
        return strdup([identifier UTF8String]);
    }
}

__attribute__((visibility("default")))
double UUID24HExpirationUnix(void) {
    @synchronized ([NSUserDefaults standardUserDefaults]) {
        NSUserDefaults *defaults = [NSUserDefaults standardUserDefaults];
        return UUID24H_ValidIdentifierLocked(defaults) ?
          [defaults doubleForKey:kExpiresKey] : 0;
    }
}

__attribute__((visibility("default")))
void UUID24HFree(char *p) {
    free(p);
}
