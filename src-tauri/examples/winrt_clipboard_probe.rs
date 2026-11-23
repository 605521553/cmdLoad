// Development probe for the official WinRT clipboard-history API.
// Run from src-tauri with: cargo run --example winrt_clipboard_probe

use windows::{
    ApplicationModel::DataTransfer::{Clipboard, ClipboardHistoryItemsResultStatus},
    Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
};

fn main() {
    unsafe {
        let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        println!("CoInitializeEx={hr:?}");
    }

    let enabled = Clipboard::IsHistoryEnabled();
    println!("IsHistoryEnabled={enabled:?}");

    let result = tauri::async_runtime::block_on(async {
        let operation = Clipboard::GetHistoryItemsAsync()?;
        operation.await
    });

    match result {
        Ok(result) => {
            println!("Status={:?}", result.Status());
            if result
                .Status()
                .unwrap_or(ClipboardHistoryItemsResultStatus::AccessDenied)
                != ClipboardHistoryItemsResultStatus::Success
            {
                println!("history status is not success");
            } else {
                let items = result.Items().unwrap();
                let count = items.Size().unwrap();
                println!("Items={count}");
                for index in 0..count {
                    let item = match items.GetAt(index) {
                        Ok(item) => item,
                        Err(error) => {
                            println!("ITEM {index} ERROR {error:?}");
                            continue;
                        }
                    };
                    let timestamp = item
                        .Timestamp()
                        .map(|value| value.UniversalTime)
                        .unwrap_or(0);
                    let text = tauri::async_runtime::block_on(async {
                        item.Content()?.GetTextAsync()?.await
                    });
                    match text {
                        Ok(text) => {
                            let text = text.to_string();
                            let preview = text
                                .chars()
                                .take(100)
                                .collect::<String>()
                                .replace('\r', "\\r")
                                .replace('\n', "\\n");
                            println!(
                                "ITEM {index} ts={timestamp} len={} {preview}",
                                text.chars().count()
                            );
                        }
                        Err(error) => println!("ITEM {index} TEXT_ERROR {error:?}"),
                    }
                }
            }
        }
        Err(error) => println!("GetHistoryItemsAsync ERROR {error:?}"),
    }

    unsafe {
        CoUninitialize();
    }
}
