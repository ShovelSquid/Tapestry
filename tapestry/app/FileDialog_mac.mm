#include "app/FileDialog.hpp"

#import <AppKit/AppKit.h>

namespace tapestry {
namespace {

std::optional<std::string> pathFromUrl(NSURL* url) {
    if (url == nil || url.path == nil) {
        return std::nullopt;
    }
    return std::string(url.path.UTF8String);
}

} // namespace

std::optional<std::string> chooseDocumentToOpen() {
    @autoreleasepool {
        NSOpenPanel* panel = [NSOpenPanel openPanel];
        panel.canChooseFiles = YES;
        panel.canChooseDirectories = NO;
        panel.allowsMultipleSelection = NO;
        panel.allowedFileTypes = @[@"tapestry"];
        panel.message = @"Open a Tapestry document";
        return [panel runModal] == NSModalResponseOK
            ? pathFromUrl(panel.URL)
            : std::nullopt;
    }
}

std::optional<std::string> chooseDocumentToSave(const std::string& suggestedPath) {
    @autoreleasepool {
        NSSavePanel* panel = [NSSavePanel savePanel];
        panel.allowedFileTypes = @[@"tapestry"];
        panel.allowsOtherFileTypes = NO;
        panel.canCreateDirectories = YES;
        panel.extensionHidden = NO;
        panel.message = @"Save the Tapestry document";

        NSString* suggested = [NSString stringWithUTF8String:suggestedPath.c_str()];
        if (suggested.length > 0) {
            panel.nameFieldStringValue = suggested.lastPathComponent;
            NSString* directory = suggested.stringByDeletingLastPathComponent;
            if (directory.length > 0 && ![directory isEqualToString:suggested]) {
                panel.directoryURL = [NSURL fileURLWithPath:directory isDirectory:YES];
            }
        }
        return [panel runModal] == NSModalResponseOK
            ? pathFromUrl(panel.URL)
            : std::nullopt;
    }
}

} // namespace tapestry
