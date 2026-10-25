$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding

# Use the Common Item Dialog directly: Windows PowerShell's .NET Framework
# FolderBrowserDialog still uses the legacy folder tree.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class WorkspaceFolderPicker
{
    [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")]
    private class FileOpenDialog { }

    // IModalWindow and IFileDialog slots must retain their native order.
    [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IFileDialog
    {
        [PreserveSig] int Show(IntPtr owner);
        void SetFileTypes(uint count, IntPtr types);
        void SetFileTypeIndex(uint index);
        void GetFileTypeIndex(out uint index);
        void Advise(IntPtr events, out uint cookie);
        void Unadvise(uint cookie);
        void SetOptions(uint options);
        void GetOptions(out uint options);
        void SetDefaultFolder(IShellItem folder);
        void SetFolder(IShellItem folder);
        void GetFolder(out IShellItem folder);
        void GetCurrentSelection(out IShellItem item);
        void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetFileName(out IntPtr name);
        void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
        void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
        void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string label);
        void GetResult(out IShellItem item);
    }

    [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellItem
    {
        void BindToHandler(IntPtr context, ref Guid handler, ref Guid iid, out IntPtr result);
        void GetParent(out IShellItem parent);
        void GetDisplayName(uint kind, out IntPtr name);
        void GetAttributes(uint mask, out uint attributes);
        void Compare(IShellItem other, uint hint, out int order);
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, PreserveSig = false)]
    private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid iid, out IShellItem item);

    public static string Pick(string initialPath)
    {
        IFileDialog dialog = (IFileDialog)new FileOpenDialog();
        IShellItem folder = null;
        IShellItem selected = null;
        IntPtr name = IntPtr.Zero;
        try
        {
            uint options;
            dialog.GetOptions(out options);
            // FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST
            dialog.SetOptions(options | 0x20u | 0x40u | 0x800u);
            dialog.SetTitle("Open project");
            dialog.SetOkButtonLabel("Open project");
            if (!String.IsNullOrEmpty(initialPath) && System.IO.Directory.Exists(initialPath))
            {
                Guid iid = typeof(IShellItem).GUID;
                SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref iid, out folder);
                dialog.SetFolder(folder);
            }
            int result = dialog.Show(IntPtr.Zero);
            if (result == unchecked((int)0x800704C7)) return null; // User cancelled.
            Marshal.ThrowExceptionForHR(result);
            dialog.GetResult(out selected);
            selected.GetDisplayName(0x80058000u, out name); // SIGDN_FILESYSPATH
            return Marshal.PtrToStringUni(name);
        }
        finally
        {
            if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
            if (selected != null) Marshal.ReleaseComObject(selected);
            if (folder != null) Marshal.ReleaseComObject(folder);
            Marshal.ReleaseComObject(dialog);
        }
    }
}
'@

try {
    [Console]::Write([WorkspaceFolderPicker]::Pick($env:PULSARWIKI_PICKER_PATH))
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
